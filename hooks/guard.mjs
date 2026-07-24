#!/usr/bin/env node
/**
 * hanja-guard — a Claude Code Stop hook.
 *
 * Reads the answer Claude just produced and flags anything that makes it hard
 * to read in Korean: Chinese characters, broken syllables, needlessly hard
 * Sino-Korean vocabulary, and unexplained jargon. Returns {"decision":"block"}
 * so Claude rewrites the answer.
 *
 * Zero dependencies. Node >= 18.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ *
 * Standard Korean syllables (KS X 1001, 2350 of the 11172 possible).
 * A Hangul syllable outside this set is almost always a typo or a
 * mangled character — 꿐, 뷁 — rather than a real word.
 * Bitmap generated with: iconv -f UTF-8 -t EUC-KR
 * ------------------------------------------------------------------ */
const KSX_B64 = "kwf/PhGwAxMBKBARAACTBXseEbADlwE7EhGgAJOVazBRsAIRATIwEbACEQEKMHm4BhMBMBAAgAATAQsQEQAAkwMrEAAAAJMFa3RRsCMTATswEAAAAAAAcBGwAxMAKRARgCEBAAAwFbAOAwEwMAAAAhEBIxAAAAATgWsQEAADEwETEBEwAAEAADBVuCIAAAAwEbAClwf7OhGwAxMBIQAAAAAbDTs4EbADEwEzEQEAABMFKxwRAAEAAAAQEbAAEwEqMBmwAgEAEBAAAAARAQMwEDACEwdrFBEAABMFK3T5uI8TATsQAAAAAAAAcNmwShMBOxARAAMRAAAwWbEqEQEAEAAAAREBCxAAAAATASsQAAABAQAgEBGgAhEBITBZsAIBAAAwGbAHEwE7OBGwAwAAAAAAAAATDTs4EbADAQAQAAAAABMBIBAQAAABAAAQAQAAAAAAMBEYAgAAABAAAAARASMAAAAAkwELEBEwABEBKzARsMcTATswAYACAAAAMBGwgxMBKzARsAMRAAowEbACEQAgAAAAAREBKxARoAITASsQAAABAQAAMBGQAhMBKzARsGYAAAAwEbAC0wdrOhGwBwMBIAAAAAATBWs4EbADEwG4EAAAABsFKxABAAMAAAAQEaACEQEKcHmwohEBChAAAAARAQAQEZAAEQEJAAAAAJMFu/L5sCITATsyASAAAAAAMFmwBpMBOzARoCMRAABwEbACEQAQEAAAARMBAxABAACTBysWEAABAQAAMBEAAhEBKTARsAAAAAAwUbAOEwU7OBGwAwMAAQAAAACTATkQAAACAwA7AAAAABMBIwAAAAAAAAAQAAAAAQAgMBGQAgAAAAAAAAAAAAAQAAACEQEDAAAAABMBK7B5sCMTATswEbACEQEh8NmwQxMBOzARsAMRASBwUbAiEwEgEBGQAREBCzARsAKTAasWAAABEwEhMBGwAgMBKTAxsAIAAAAwGbhCGwEzOBEwAwAAIAAAAAATBTMQEQAAAAAAAAEAAJMFIzABAAEBABAQETAAAQAAMBEwAgEAEBAAAAARAAAAAAACE4UDEBEQABMBKzB3uGMTATswkbCiEQECMHvwVxMBK3DR8OMRARswcbkKEwE7MAGQAhMBKzARsAITByswETADEwEjMBGwAhMBqzARtP4RAQkwcbhH0wV7MBGwA1MBIRARAAATBWswEbACEQEzEAAAABMF6zgQoAIBADAQEbACEwAgMHGwAgEAEBAAAAATAQsQERAAEwErAAAAAJMFazaVsAMTATsQAQACAAAAMBGwAwEAIBAAAAEAAAAwEbAKAwEQEAAAAREBAwAAAAITASMQAAADAAAAEAAAAAEAABAAkAIAAAAwETCGUwF7MBGwA1EBIQAAAAATATswEbACEQAQEAEAAhMBKxARAAIAAAAQEbACAQABMBGwAgEAEBABAAARASsQERACEwErAAAAAJMDKzARsAITATswAAACAAAAMBmwAxMBKxARsAMBAAAwEbACEwEhEAAAAgEBABAAAAATASsQEQACAQAgMBGwAhEBATARMAIAAAAwEbACEwM7MBGwAwEAIAAAAAATBTswEbACEQAQEAEAABMBKxQBAAABAAAQAYACAQAAMBGwAgEAEBAAAAATASMQERACkwULEBEwABMBK3BRsCMTATswAAAAAAAAMBGwAxMBKxARMAMBAQowEbACAQAgAAAAABEAABARoACTBSsQAAACAAAAEBGQABEBKRARsAAAAAAwEbACEyErMBGwAwEAIAAAAAATBSswEbACEwE7EBEgABMhKzIRgAITACgwEaACEQEKMBGSAhEBITARAAITASswEZAC0wMrEhEwAhMBKwA=";
const KSX = Buffer.from(KSX_B64, "base64");
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

const isHangulSyllable = (cp) => cp >= HANGUL_START && cp <= HANGUL_END;
const isStandardSyllable = (cp) => {
  const i = cp - HANGUL_START;
  return (KSX[i >> 3] & (1 << (i & 7))) !== 0;
};

/* ------------------------------------------------------------------ *
 * Word lists. Deliberately short — extend them in .hanja-guard.json
 * rather than trying to be exhaustive here.
 * ------------------------------------------------------------------ */

/**
 * Hard Sino-Korean words that have an everyday equivalent.
 * Kept short on purpose, and tuned to avoid domain vocabulary: "저해" and
 * "발현" were removed because "저해제"(inhibitor) and "유전자 발현" are the
 * correct terms in biotech writing. Trim or extend this in .hanja-guard.json
 * to match the field you write about.
 */
const HARD_WORDS = [
  "골자", "방증", "상정", "제고", "기인", "상충", "천착", "개진", "반추", "함의",
  "소기", "일견", "요체", "답보", "괄목", "명징", "자명", "봉착", "기제", "소구",
  "제반", "여타", "차치", "불식", "가일층", "유수", "기치", "이바지", "미증유", "부단",
];

/** Technical terms that need a one-line gloss the first time they appear. */
const JARGON = [
  "CJK", "regex", "정규식", "훅", "hook", "트랜스크립트", "transcript",
  "스트리밍", "페이로드", "payload", "파싱", "인코딩", "유니코드", "코드포인트",
  "비트맵", "폴백", "fallback", "래퍼", "wrapper", "파이프라인", "마이그레이션",
  "리팩터링", "이터레이션", "오케스트레이션", "프로비저닝", "아티팩트",
  "sidechain", "stdin", "stdout", "휴리스틱", "정규화", "직렬화", "멱등",
];

const CHAR_RANGES = {
  // CJK Unified Ideographs: ext A, main block, compatibility block
  hanja: { re: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu, label: "\uD55C\uC790" },
  // Hiragana + Katakana
  kana: { re: /[\u3040-\u30FF]/gu, label: "\uAC00\uB098" },
  // Full-width and ideographic punctuation
  punct: { re: /[\uFF01\uFF08\uFF09\uFF0C\uFF1A\uFF1B\uFF1F\u3001\u3002]/gu, label: "\uC804\uAC01 \uBB38\uC7A5\uBD80\uD638" },
};

/**
 * A jargon term counts as explained if it is followed by a parenthetical
 * or sits inside one — `정규식(글자 찾는 규칙)` or `규칙(정규식)`.
 * Only the first occurrence matters; later ones ride on that explanation.
 */
function isGlossed(text, term) {
  const i = text.indexOf(term);
  if (i < 0) return true;
  if (text.slice(i + term.length, i + term.length + 3).includes("(")) return true;
  const before = text.slice(Math.max(0, i - 40), i);
  return before.lastIndexOf("(") > before.lastIndexOf(")");
}

/**
 * Korean glues words together, so a plain substring match is wrong:
 * "대상이" contains "상이", "중소기업" contains "소기", "비수기인" contains "기인".
 * Only count a word where it starts one — the character before it must not be
 * a Hangul syllable.
 */
const WORD_CHAR = /[\p{Script=Hangul}\p{L}\p{N}]/u;

function findWords(text, words) {
  return words.filter((w) => {
    let i = -1;
    while ((i = text.indexOf(w, i + 1)) >= 0) {
      if (i === 0 || !WORD_CHAR.test(text[i - 1])) return true;
    }
    return false;
  });
}

const DETECTORS = {
  hanja: { label: "한자", find: (t) => matchChars(t, CHAR_RANGES.hanja.re) },
  kana: { label: "가나", find: (t) => matchChars(t, CHAR_RANGES.kana.re) },
  punct: { label: "전각 문장부호", find: (t) => matchChars(t, CHAR_RANGES.punct.re) },
  broken: {
    label: "깨진 글자",
    find: (t) => {
      const out = [];
      if (t.includes("�")) out.push("�");
      for (const ch of t) {
        const cp = ch.codePointAt(0);
        if (isHangulSyllable(cp) && !isStandardSyllable(cp)) out.push(ch);
      }
      return out;
    },
  },
  hard: { label: "어려운 말", find: (t) => findWords(t, HARD_WORDS) },
  jargon: {
    label: "설명 없는 전문용어",
    find: (t) => findWords(t, JARGON).filter((w) => !isGlossed(t, w)),
  },
};

/** Instruction appended per detector when asking for a rewrite. */
const FIXES = {
  한자: "같은 뜻의 한국어로 바꾸세요.",
  가나: "같은 뜻의 한국어로 바꾸세요.",
  "전각 문장부호": "일반 문장부호로 바꾸세요.",
  "깨진 글자": "오타이니 올바른 낱말로 고치세요.",
  "어려운 말": "누구나 아는 쉬운 말로 바꾸세요. 예: 골자 → 요점, 제고 → 높임.",
  "설명 없는 전문용어": "처음 나올 때 괄호로 한 줄 설명을 붙이세요. 예: 정규식(글자를 찾는 규칙).",
};

const matchChars = (text, re) => [...text.matchAll(re)].map((m) => m[0]);

const DEFAULTS = {
  enabled: true,
  detect: ["hanja", "punct", "broken"],
  allow: [],
  maxRetries: 2,
};

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

/** Code and inline code are exempt — the rules there are not Korean prose rules. */
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

/** @returns {Map<string,string>} offending token -> detector label */
export function scan(text, cfg, allowed = "") {
  const hits = new Map();
  for (const key of cfg.detect || []) {
    const d = DETECTORS[key];
    if (!d) continue;
    for (const token of d.find(text)) {
      if (hits.has(token)) continue;
      // A single character is allowed if it appears in the allow text;
      // a whole word must appear as a word.
      if (token.length === 1 ? allowed.includes(token) : allowed.includes(token)) continue;
      hits.set(token, d.label);
    }
  }
  return hits;
}

function buildReason(hits) {
  const byLabel = new Map();
  for (const [token, label] of hits) {
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(token);
  }

  const lines = ["방금 출력한 답변에 읽기 어려운 부분이 있습니다.", ""];
  for (const [label, tokens] of byLabel) {
    lines.push(`- ${label}: ${tokens.slice(0, 20).join(", ")} → ${FIXES[label] || ""}`);
  }
  lines.push(
    "",
    "위 내용을 고쳐서 답변 전체를 다시 작성하세요.",
    "- 코드, 명령어, 파일 경로, 고유명사 원문 표기는 그대로 두세요.",
    "- 내용이나 정확도는 바꾸지 말고 표현만 쉽게 바꾸세요.",
    "- 고쳤다는 설명이나 사과는 하지 말고, 교정된 답변만 출력하세요.",
  );
  return lines.join("\n");
}

const readStdin = async () => {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

/**
 * PreToolUse — runs before a tool executes, so a broken syllable in a tool
 * argument can be stopped before anyone sees it. Answer text cannot be caught
 * this way because it streams straight to the terminal; tool arguments can.
 *
 * Only the `broken` check applies here. Hanja must not: writing Chinese into
 * a file is often deliberate, and this plugin's own test cases contain 上昇 —
 * checking hanja on Write would make the plugin uneditable.
 */
async function preToolHook() {
  let input = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const cfg = loadConfig(input.cwd);
  if (!cfg.enabled || process.env.HANJA_GUARD === "off") process.exit(0);
  if (!(cfg.detect || []).includes("broken")) process.exit(0);

  const text = typeof input.tool_input === "string" ? input.tool_input : JSON.stringify(input.tool_input ?? "");
  const allowed = (cfg.allow || []).join(" ");
  const hits = DETECTORS.broken.find(text).filter((ch) => !allowed.includes(ch));

  const stateFile = path.join(os.tmpdir(), `hanja-guard-pre-${input.session_id || "session"}.json`);
  if (hits.length === 0) {
    try {
      fs.unlinkSync(stateFile);
    } catch {
      /* nothing to clear */
    }
    process.exit(0);
  }

  // Never wedge the session: after a few refusals, let the call through.
  let attempt = 0;
  try {
    attempt = JSON.parse(fs.readFileSync(stateFile, "utf8")).n || 0;
  } catch {
    /* first refusal for this session */
  }
  attempt++;

  const chars = [...new Set(hits)].join(" ");
  if (attempt > cfg.maxRetries) {
    try {
      fs.unlinkSync(stateFile);
    } catch {
      /* nothing to clear */
    }
    console.log(
      JSON.stringify({
        systemMessage: `🛡 hanja-guard: 깨진 글자(${chars})가 남았지만 ${cfg.maxRetries}회 후 통과시킵니다`,
      }),
    );
    process.exit(0);
  }

  fs.writeFileSync(stateFile, JSON.stringify({ n: attempt }));
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `${input.tool_name} 입력에 한국어에 없는 글자가 있습니다: ${chars}\n` +
          "오타로 보입니다. 올바른 글자로 고쳐서 다시 실행하세요. 내용은 바꾸지 마세요.",
      },
      systemMessage: `🛡 hanja-guard: ${input.tool_name} 입력의 깨진 글자 감지 (${chars}) → 고쳐서 다시 ${attempt}/${cfg.maxRetries}`,
    }),
  );
}

async function main() {
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
  const allowed = prompt + " " + (cfg.allow || []).join(" ");
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

  const summary = [...hits.keys()].slice(0, 8).join(" ");

  // Give up rather than loop forever if Claude keeps producing the same problems.
  if (attempt > cfg.maxRetries) {
    clearState();
    console.log(
      JSON.stringify({
        systemMessage: `🛡 hanja-guard: ${cfg.maxRetries}회 교정 후에도 남아 중단합니다 — ${summary}`,
      }),
    );
    process.exit(0);
  }

  fs.writeFileSync(stateFile, JSON.stringify({ n: attempt }));
  console.log(
    JSON.stringify({
      decision: "block",
      reason: buildReason(hits),
      systemMessage: `🛡 hanja-guard: 감지 (${summary}) → 다시 쓰기 요청 ${attempt}/${cfg.maxRetries}`,
    }),
  );
}

function selfTest() {
  const ALL = ["hanja", "punct", "broken", "hard", "jargon"];
  const cases = [
    // 한자 / 문장부호
    { n: "중국어 섞인 답변", a: "코스피가 上昇했습니다", p: "코스피 어때", want: true },
    { n: "전각 쉼표", a: "결과，확인했습니다", p: "확인해줘", want: true },
    { n: "간체자 문장", a: "这是一个测试", p: "테스트", want: true },
    { n: "프롬프트에 있던 한자", a: "日経平均은 3만엔입니다", p: "日経平均 시황 써줘", want: false },
    { n: "코드블록 안 중국어", a: "예시입니다\n```py\nprint('中文')\n```", p: "예시", want: false },
    { n: "인라인 코드", a: "변수 `中文` 을 쓰세요", p: "변수명", want: false },
    { n: "allow 목록", a: "上海 증시", p: "중국 증시", want: false, allow: ["上海"] },
    // 깨진 글자
    { n: "깨진 음절 (꿐져)", a: "기본은 꿐져 두고 씁니다", p: "설정", want: true, only: ["broken"] },
    { n: "올바른 음절 (꺼져)", a: "기본은 꺼져 두고 씁니다", p: "설정", want: false, only: ["broken"] },
    { n: "깨진 음절 (뷁)", a: "값이 뷁으로 나옵니다", p: "값", want: true, only: ["broken"] },
    { n: "받침 어려운 정상 단어", a: "부엌에서 몫을 읊고 앉았다", p: "문장", want: false, only: ["broken"] },
    { n: "U+FFFD 깨짐", a: "한글이 ��로 나옵니다", p: "확인", want: true, only: ["broken"] },
    // 어려운 한자어
    { n: "어려운 말 (골자)", a: "묶어야 한다는 게 골자다", p: "정리해줘", want: true, only: ["hard"] },
    { n: "쉬운 말 (요점)", a: "묶어야 한다는 게 요점이다", p: "정리해줘", want: false, only: ["hard"] },
    { n: "어려운 말 (제고)", a: "효율을 제고해야 합니다", p: "개선안", want: true, only: ["hard"] },
    // 낱말 경계 — 다른 말의 일부는 잡지 않는다
    { n: "낱말 일부 (대상이)", a: "대조 대상이 아니라", p: "비교", want: false, only: ["hard"] },
    { n: "낱말 일부 (비수기인)", a: "전통적 비수기인 데다", p: "실적", want: false, only: ["hard"] },
    { n: "낱말 일부 (중소기업)", a: "중소기업 지원 정책", p: "정책", want: false, only: ["hard"] },
    { n: "낱말 일부 (자산재평가)", a: "자산재평가 이슈", p: "공시", want: false, only: ["hard"] },
    { n: "숫자 뒤 (임상 3상이)", a: "임상 2·3상이 진행 중", p: "임상", want: false, only: ["hard"] },
    { n: "낱말 첫머리 (기인한다)", a: "계절성에 기인한다", p: "원인", want: true, only: ["hard"] },
    { n: "굵게 표시 (**골자**)", a: "핵심은 **골자**입니다", p: "정리", want: true, only: ["hard"] },
    // 전문용어
    { n: "설명 없는 전문용어", a: "CJK 범위 regex가 깨졌습니다", p: "고쳐줘", want: true, only: ["jargon"] },
    { n: "괄호로 설명함", a: "정규식(글자를 찾는 규칙)이 잘못됐습니다", p: "고쳐줘", want: false, only: ["jargon"] },
    { n: "괄호 안에 원어", a: "글자를 찾는 규칙(정규식)이 잘못됐습니다", p: "고쳐줘", want: false, only: ["jargon"] },
    { n: "사용자가 먼저 쓴 용어", a: "regex를 고쳤습니다", p: "regex 좀 고쳐줘", want: false, only: ["jargon"] },
    // 정상
    { n: "순수 쉬운 한국어", a: "코스피가 상승했습니다.", p: "코스피 어때", want: false },
  ];

  let failed = 0;
  for (const c of cases) {
    const cfg = { ...DEFAULTS, detect: c.only || ALL, allow: c.allow || [] };
    const allowed = c.p + " " + cfg.allow.join(" ");
    const hits = scan(stripCode(c.a), cfg, allowed);
    const got = hits.size > 0;
    const ok = got === c.want;
    if (!ok) failed++;
    const detail = hits.size ? ` [${[...hits.keys()].slice(0, 6).join(" ")}]` : "";
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.n}${detail}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes("--selftest")) selfTest();
else if (process.argv[2] === "pretool") await preToolHook();
else await main();
