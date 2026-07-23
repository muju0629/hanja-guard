# hanja-guard 🛡

**Claude Code sometimes drops Chinese characters into Korean answers. This plugin catches them and makes Claude rewrite.**

[한국어 문서 ↓](#한국어)

```
You:    코스피 오늘 어때?
Claude: 코스피가 上昇했습니다，2,650선을 회복했네요.
        └─ 🛡 hanja-guard: 비한국어 문자 감지 (上 昇 ，) → 재작성 요청 1/2
Claude: 코스피가 상승했습니다. 2,650선을 회복했네요.
```

No API calls, no dependencies, no model in the loop — one 200-line Node script that runs on a `Stop` hook.
It adds **0 tokens** to your context (`claude plugin details hanja-guard` → `Always-on: ~0 tok`).

---

## Install

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

That's it. Requires Node 18+ (Claude Code already ships with it).

To turn it off for one session: `HANJA_GUARD=off claude`

---

## How it works

Claude Code fires a `Stop` hook when an answer finishes. The hook reads the last
assistant message out of the session transcript, scans it, and — if it finds
characters that don't belong in a Korean reply — returns

```json
{ "decision": "block", "reason": "…rewrite this in Korean…" }
```

which pushes Claude to redo the answer in the same turn.

**What it flags, by default**

| Class | Range | Example |
|---|---|---|
| CJK ideographs | `U+3400–4DBF`, `U+4E00–9FFF`, `U+F900–FAFF` | 上昇, 这是一个测试 |
| Full-width / ideographic punctuation | `！（），：；？、。` | 결과，확인 |
| Kana *(opt-in)* | `U+3040–30FF` | こんにちは |

---

## Avoiding false positives

A language guard is only as good as its exceptions. hanja-guard skips:

**1. Anything you typed yourself.** Every character in your prompt is whitelisted for that turn. Ask about `日経平均` and Claude may answer with `日経平均` — but `上昇` in that same answer still gets flagged.

**2. Code.** Fenced blocks and inline code are stripped before scanning, so `print('中文')` and `` `变量` `` pass through untouched.

**3. Thinking blocks.** Only the visible answer text is scanned.

**4. Subagent output.** Sidechain records in the transcript are ignored.

**5. Your allowlist.** See below.

And it never loops: after `maxRetries` corrections it gives up with a warning instead of blocking forever.

---

## Config

Optional. Drop a `.hanja-guard.json` in your project root (or `~/.hanja-guard.json` for all projects):

```json
{
  "enabled": true,
  "detect": ["hanja", "punct"],
  "allow": ["日経平均", "上海", "恒生"],
  "maxRetries": 2
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `detect` | `["hanja","punct"]` | Any of `hanja`, `punct`, `kana` |
| `allow` | `[]` | Strings whose characters are always permitted |
| `maxRetries` | `2` | Rewrite attempts before giving up |

Project config overrides user config. The env var `HANJA_GUARD=off` overrides both.

---

## Test it

```bash
node hooks/guard.mjs --selftest
```

```
PASS  중국어 섞인 답변 [上 昇]
PASS  전각 쉼표 [，]
PASS  간체자 문장 [这 是 一 个 测 试]
PASS  프롬프트에 있던 한자
PASS  코드블록 안 중국어
PASS  인라인 코드
PASS  순수 한국어
PASS  allow 목록
PASS  가나(기본 미탐지)
PASS  가나(옵션 켜면 탐지) [こ ん に ち は]

10/10 passed
```

---

## Limitations

Worth knowing before you install:

- **It corrects *after* the fact, not before.** Claude Code streams text to your terminal as it is generated; no hook can intercept it mid-flight. You will see the contaminated answer for a moment, then the corrected one. This is the closest thing to prevention the hook API allows.
- **The rewrite costs one extra turn** — a second response is generated.
- **Character-class detection only.** It catches "wrong script," not "awkward Korean." Machine-translation-flavored phrasing that uses only Hangul will pass.
- **Terminal answers only.** Chinese characters that Claude writes *into files* are not checked (a `PostToolUse` hook could do that — see [issues](https://github.com/muju0629/hanja-guard/issues) if you want it).

---

## 한국어

Claude Code가 한국어로 답하다가 가끔 `上昇`, `这是`, `，` 같은 한자·중국어 문장부호를 흘립니다.
hanja-guard는 답변이 끝나는 순간 `Stop` 훅으로 그걸 잡아내고, Claude가 같은 턴에서 한국어로 다시 쓰게 만듭니다.

### 설치

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

한 세션만 끄기: `HANJA_GUARD=off claude`

### 오탐을 피하는 방법

이런 도구는 오탐이 나는 순간 짜증나서 지우게 됩니다. 그래서 다음은 전부 통과시킵니다.

- **내가 프롬프트에 쓴 문자** — `日経平均 시황 써줘`라고 물으면 답변의 `日経平均`은 허용. 같은 답변의 `上昇`은 여전히 차단.
- **코드블록·인라인 코드** — `print('中文')`은 건드리지 않음
- **thinking 블록** — 화면에 보이는 답변 텍스트만 검사
- **서브에이전트 출력** — sidechain 레코드는 무시
- **`.hanja-guard.json`의 `allow` 목록**

그리고 `maxRetries`(기본 2회)를 넘으면 무한 루프 대신 경고만 남기고 포기합니다.

### 설정

프로젝트 루트에 `.hanja-guard.json`(또는 전역은 `~/.hanja-guard.json`):

```json
{
  "detect": ["hanja", "punct", "kana"],
  "allow": ["日経平均", "上海"],
  "maxRetries": 2
}
```

`detect`에 `kana`를 넣으면 히라가나·가타카나도 잡습니다(기본 꺼짐).

### 한계

- **출력 "전"이 아니라 "직후" 교정입니다.** 답변은 생성되는 대로 터미널에 스트리밍되므로 훅이 중간에 가로챌 수 없습니다. 오염된 답변이 잠깐 보이고, 곧바로 교정본이 나옵니다.
- 교정 시 답변이 한 번 더 생성되므로 토큰을 조금 더 씁니다.
- **문자 종류만 봅니다.** "한글로만 쓰인 어색한 번역투"는 잡지 못합니다.
- 터미널 답변만 검사하고, 파일에 쓰인 한자는 검사하지 않습니다.

---

MIT © [muju0629](https://github.com/muju0629)
