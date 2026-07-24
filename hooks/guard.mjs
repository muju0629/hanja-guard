#!/usr/bin/env node
/**
 * hanja-guard — a Claude Code Stop hook.
 *
 * Reads the answer Claude just produced, flags characters that don't belong in
 * a Korean reply (CJK ideographs, full-width punctuation, optionally kana), and
 * returns {"decision":"block"} so Claude rewrites the answer in Korean.
 *
 * Zero dependencies. Node >= 18.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DETECTORS = {
  // CJK Unified Ideographs: ext A, main block, compatibility block
  hanja: { re: /[㐀-䶿一-鿿豈-﫿]/gu, label: "한자" },
  // Hiragana + Katakana
  kana: { re: /[぀-ヿ]/gu, label: "가나" },
  // Full-width and ideographic punctuation: ！（），：；？、。
  punct: { re: /[！（），：；？、。]/gu, label: "전각 문장부호" },
};

const DEFAULTS = {
  enabled: true,
  prevent: true,
  detect: ["hanja", "punct"],
  allow: [],
  maxRetries: 2,
};

/** Injected before generation on Korean turns — layer 1 (prevention). */
const REMINDER =
  "[hanja-guard] 답변은 한국어로 작성하세요. 한자나 중국어 전각 문장부호(，。？！)를 섞지 마세요. " +
  "코드, 명령어, 파일 경로, 고유명사 원문 표기는 예외입니다.";

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/u;

/** Project config wins over user config. */
function loadConfig(cwd) {
  const cfg = { ...DEFAULTS };
  const files = [path.join(os.homedir(), ".hanja-guard.json")];
  if (cwd) files.push(path.join(cwd, ".hanja-guard.json"));
  for (const file of files) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      /* missing or malformed config is not fatal */
    }
  }
  return cfg;
}

const stripMeta = (s) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<local-command-[\s\S]*?<\/local-command-[a-z-]*>/g, " ");

/** Code and inline code are exempt — CJK string literals there are usually intentional. */
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");

/**
 * Walk the transcript backwards: collect the assistant text of the current turn,
 * stop at the user prompt that started it. Sidechains (subagents) are skipped.
 */
function lastTurn(transcriptPath) {
  const records = [];
  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* partial write at the tail of the file */
    }
  }

  const answer = [];
  let prompt = "";
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.isSidechain) continue;
    if (r.type === "assistant") {
      const text = (r.message?.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) answer.unshift(text);
    } else if (r.type === "user") {
      const c = r.message?.content;
      const text =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n")
            : "";
      const clean = stripMeta(text).trim();
      if (clean) {
        prompt = clean;
        break;
      }
    }
  }
  return { answer: answer.join("\n"), prompt };
}

/** @returns {Map<string,string>} offending character -> detector label */
export function scan(text, cfg, allowed = new Set()) {
  const hits = new Map();
  for (const key of cfg.detect || []) {
    const d = DETECTORS[key];
    if (!d) continue;
    for (const [ch] of text.matchAll(d.re)) {
      if (allowed.has(ch) || hits.has(ch)) continue;
      hits.set(ch, d.label);
    }
  }
  return hits;
}

/**
 * Layer 1 decides per turn, so the reminder costs nothing on turns it can't help.
 * Remind only when the user is writing Korean and has not asked for the very
 * characters we would flag — otherwise a request about 日経平均 gets nagged.
 */
export function shouldRemind(prompt, cfg) {
  if (!HANGUL.test(prompt)) return false;
  const allowed = new Set((cfg.allow || []).join(""));
  return scan(stripCode(prompt), cfg, allowed).size === 0;
}

function buildReason(hits) {
  const byLabel = new Map();
  for (const [ch, label] of hits) {
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(ch);
  }
  const listed = [...byLabel]
    .map(([label, chars]) => `${label}: ${chars.slice(0, 20).join(" ")}`)
    .join(" / ");

  return [
    `방금 출력한 답변에 한국어가 아닌 문자가 섞여 있습니다 — ${listed}`,
    "",
    "해당 부분을 같은 뜻의 자연스러운 한국어로 바꿔서 답변 전체를 다시 작성하세요.",
    "- 코드, 명령어, 파일 경로, 고유명사 원문 표기는 그대로 두세요.",
    "- 사용자가 그 문자를 직접 요청한 경우가 아니라면 남기지 마세요.",
    "- 교정했다는 설명이나 사과는 하지 말고, 교정된 답변만 출력하세요.",
  ].join("\n");
}

const readStdin = async () => {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

/** Layer 1 — UserPromptSubmit: inject the reminder before Claude generates. */
async function promptHook() {
  let input = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled || !cfg.prevent || process.env.HANJA_GUARD === "off") process.exit(0);
  if (!shouldRemind(input.prompt || "", cfg)) process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: REMINDER,
      },
    }),
  );
}

/** Layer 2 — Stop: catch whatever slipped through and ask for a rewrite. */
async function stopHook() {
  let input = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled || process.env.HANJA_GUARD === "off") process.exit(0);

  const transcript = input.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) process.exit(0);

  const { answer, prompt } = lastTurn(transcript);
  if (!answer.trim()) process.exit(0);

  // Anything the user typed is fair game to echo back, as is the configured allowlist.
  const allowed = new Set([...prompt, ...(cfg.allow || []).join("")]);
  const hits = scan(stripCode(answer), cfg, allowed);

  const stateFile = path.join(os.tmpdir(), `hanja-guard-${input.session_id || "session"}.json`);
  const clearState = () => {
    try {
      fs.unlinkSync(stateFile);
    } catch {
      /* nothing to clear */
    }
  };

  if (hits.size === 0) {
    clearState();
    process.exit(0);
  }

  let attempt = 0;
  try {
    attempt = JSON.parse(fs.readFileSync(stateFile, "utf8")).n || 0;
  } catch {
    /* first offence this session */
  }
  attempt++;

  const chars = [...hits.keys()].join(" ");

  // Give up rather than loop forever if Claude keeps emitting the same characters.
  if (attempt > cfg.maxRetries) {
    clearState();
    console.log(
      JSON.stringify({
        systemMessage: `🛡 hanja-guard: ${cfg.maxRetries}회 교정 후에도 남아 중단합니다 — ${chars}`,
      }),
    );
    process.exit(0);
  }

  fs.writeFileSync(stateFile, JSON.stringify({ n: attempt }));
  console.log(
    JSON.stringify({
      decision: "block",
      reason: buildReason(hits),
      systemMessage: `🛡 hanja-guard: 비한국어 문자 감지 (${chars}) → 재작성 요청 ${attempt}/${cfg.maxRetries}`,
    }),
  );
}

function selfTest() {
  const cases = [
    // "코스피가 上昇했습니다"
    { name: "중국어 섞인 답변", answer: "코스피가 上昇했습니다", prompt: "코스피 어때", expect: true },
    // "결과，확인했습니다"
    { name: "전각 쉼표", answer: "결과，확인했습니다", prompt: "확인해줘", expect: true },
    // "这是一个测试"
    { name: "간체자 문장", answer: "这是一个测试", prompt: "테스트", expect: true },
    // 日経平均 — appears in the user's own prompt, so it is allowed
    { name: "프롬프트에 있던 한자", answer: "日経平均은 3만엔입니다", prompt: "日経平均 시황 써줘", expect: false },
    { name: "코드블록 안 중국어", answer: "예시입니다\n```py\nprint('中文')\n```", prompt: "예시", expect: false },
    { name: "인라인 코드", answer: "변수 `中文` 을 쓰세요", prompt: "변수명", expect: false },
    { name: "순수 한국어", answer: "코스피가 상승했습니다.", prompt: "코스피 어때", expect: false },
    { name: "allow 목록", answer: "上海 증시", prompt: "중국 증시", expect: false, allow: ["上海"] },
    { name: "가나(기본 미탐지)", answer: "こんにちは", prompt: "인사", expect: false },
    { name: "가나(옵션 켜면 탐지)", answer: "こんにちは", prompt: "인사", expect: true, detect: ["hanja", "punct", "kana"] },
  ];

  // Layer 1: which turns get the reminder injected
  const reminders = [
    { name: "한국어 질문", prompt: "코스피 오늘 어때?", expect: true },
    { name: "한글 자모만", prompt: "ㅇㅋ 고고", expect: true },
    { name: "영어 질문", prompt: "what is this?", expect: false },
    { name: "한자를 직접 물어봄", prompt: "日経平均 시황 써줘", expect: false },
    { name: "중국어 질문", prompt: "这是什么", expect: false },
    { name: "allow 목록 한자", prompt: "上海 증시 알려줘", expect: true, allow: ["上海"] },
    { name: "코드블록 속 한자", prompt: "이거 봐줘\n```py\nx='中文'\n```", expect: true },
  ];

  let failed = 0;
  for (const c of cases) {
    const cfg = { ...DEFAULTS, detect: c.detect || DEFAULTS.detect, allow: c.allow || [] };
    const allowed = new Set([...c.prompt, ...cfg.allow.join("")]);
    const hits = scan(stripCode(c.answer), cfg, allowed);
    const got = hits.size > 0;
    const ok = got === c.expect;
    if (!ok) failed++;
    const detail = hits.size ? ` [${[...hits.keys()].join(" ")}]` : "";
    console.log(`${ok ? "PASS" : "FAIL"}  [탐지] ${c.name}${detail}`);
  }
  for (const c of reminders) {
    const cfg = { ...DEFAULTS, allow: c.allow || [] };
    const got = shouldRemind(c.prompt, cfg);
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  [예방] ${c.name} → ${got ? "주입" : "생략"}`);
  }

  const total = cases.length + reminders.length;
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes("--selftest")) selfTest();
else if (process.argv[2] === "prompt") await promptHook();
else await stopHook();
