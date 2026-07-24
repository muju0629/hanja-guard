# hanja-guard 🛡

**Claude Code sometimes drops Chinese characters into Korean answers. This plugin keeps them out — and rewrites the ones that get through.**

[한국어 문서 ↓](#한국어)

```
You:     코스피 오늘 어때?
         └─ 🛡 layer 1 — reminder injected before Claude generates
Claude:  코스피가 상승했습니다. 2,650선을 회복했네요.
```

```
(when one slips through anyway)
Claude:  코스피가 上昇했습니다，2,650선을 회복했네요.
         └─ 🛡 layer 2 — hanja-guard: 비한국어 문자 감지 (上 昇 ，) → 재작성 요청 1/2
Claude:  코스피가 상승했습니다. 2,650선을 회복했네요.
```

No API calls, no dependencies, no model in the loop — one Node script on two hooks.
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

## Why two layers

Claude Code exposes exactly nine hook events:

```
PreToolUse  PostToolUse  UserPromptSubmit  Stop  SubagentStop
Notification  PreCompact  SessionStart  SessionEnd
```

**None of them fire while an answer is being written.** Text streams straight to your
terminal as it is generated, and the Messages API has no token-ban parameter either
(`stop_sequences` halts generation — it would truncate the answer, not fix it). So a
plugin cannot intercept a character between generation and display. What it *can* do is
act on both sides of that gap:

| | Hook | When | What it does | Guarantee |
|---|---|---|---|---|
| **Layer 1 — prevention** | `UserPromptSubmit` | before generation | Injects a one-line "answer in Korean" reminder into the turn | Lowers the rate. Not absolute. |
| **Layer 2 — correction** | `Stop` | after the answer finishes | Scans it, returns `{"decision":"block"}` so Claude rewrites in the same turn | Catches what layer 1 missed. |

Neither alone is enough: prevention is probabilistic, and correction is post-hoc. Together
most turns are clean on the first try, and the rest get fixed before you act on them.

**What it flags, by default**

| Class | Range | Example |
|---|---|---|
| CJK ideographs | `U+3400–4DBF`, `U+4E00–9FFF`, `U+F900–FAFF` | 上昇, 这是一个测试 |
| Full-width / ideographic punctuation | `！（），：；？、。` | 결과，확인 |
| Kana *(opt-in)* | `U+3040–30FF` | こんにちは |

---

## Avoiding false positives

A language guard is only as good as its exceptions. Both layers skip:

**1. Anything you typed yourself.** Every character in your prompt is whitelisted for that
turn. Ask about `日経平均` and layer 1 stays quiet while layer 2 lets `日経平均` through —
but `上昇` in that same answer still gets flagged.

**2. Non-Korean turns.** Layer 1 only fires when your prompt actually contains Hangul, so
English sessions never pay for the reminder.

**3. Code.** Fenced blocks and inline code are stripped before scanning, so `print('中文')`
and `` `变量` `` pass through untouched.

**4. Thinking blocks.** Only the visible answer text is scanned.

**5. Subagent output.** Sidechain records in the transcript are ignored.

**6. Your allowlist.** See below.

And it never loops: after `maxRetries` corrections layer 2 gives up with a warning instead
of blocking forever.

---

## Config

Optional. Drop a `.hanja-guard.json` in your project root (or `~/.hanja-guard.json` for all projects):

```json
{
  "enabled": true,
  "prevent": true,
  "detect": ["hanja", "punct"],
  "allow": ["日経平均", "上海", "恒生"],
  "maxRetries": 2
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch for both layers |
| `prevent` | `true` | Layer 1 only — set `false` to keep correction without the injected reminder |
| `detect` | `["hanja","punct"]` | Any of `hanja`, `punct`, `kana` |
| `allow` | `[]` | Strings whose characters are always permitted |
| `maxRetries` | `2` | Rewrite attempts before layer 2 gives up |

Project config overrides user config. The env var `HANJA_GUARD=off` overrides both.

---

## Test it

```bash
node hooks/guard.mjs --selftest
```

```
PASS  [탐지] 중국어 섞인 답변 [上 昇]
PASS  [탐지] 전각 쉼표 [，]
PASS  [탐지] 간체자 문장 [这 是 一 个 测 试]
PASS  [탐지] 프롬프트에 있던 한자
PASS  [탐지] 코드블록 안 중국어
PASS  [탐지] 인라인 코드
PASS  [탐지] 순수 한국어
PASS  [탐지] allow 목록
PASS  [탐지] 가나(기본 미탐지)
PASS  [탐지] 가나(옵션 켜면 탐지) [こ ん に ち は]
PASS  [예방] 한국어 질문 → 주입
PASS  [예방] 한글 자모만 → 주입
PASS  [예방] 영어 질문 → 생략
PASS  [예방] 한자를 직접 물어봄 → 생략
PASS  [예방] 중국어 질문 → 생략
PASS  [예방] allow 목록 한자 → 주입
PASS  [예방] 코드블록 속 한자 → 주입

17/17 passed
```

---

## Limitations

Worth knowing before you install:

- **Layer 1 is a nudge, not a lock.** It changes the odds; it cannot make contamination impossible. That is what layer 2 is for.
- **Layer 2 corrects *after* the fact.** Claude Code streams text to your terminal as it is generated, and no hook fires in between (see the nine events above). When layer 1 misses, you see the contaminated answer for a moment, then the corrected one.
- **A layer-2 rewrite costs one extra turn** — a second response is generated.
- **Character-class detection only.** It catches "wrong script," not "awkward Korean." Machine-translation-flavored phrasing that uses only Hangul will pass.
- **Terminal answers only.** Chinese characters that Claude writes *into files* are not checked (a `PostToolUse` hook could do that — see [issues](https://github.com/muju0629/hanja-guard/issues) if you want it).

---

## 한국어

Claude Code가 한국어로 답하다가 가끔 `上昇`, `这是`, `，` 같은 한자·중국어 문장부호를 흘립니다.
hanja-guard는 두 층으로 막습니다.

| | 훅 | 시점 | 하는 일 | 보장 |
|---|---|---|---|---|
| **1층 · 예방** | `UserPromptSubmit` | 생성 전 | "한국어로 답하라" 한 줄을 턴에 주입 | 발생률을 낮춤. 절대적이지 않음 |
| **2층 · 교정** | `Stop` | 답변 종료 후 | 검사 후 `decision:block`으로 같은 턴에서 재작성 | 1층이 놓친 것을 잡음 |

Claude Code의 훅 이벤트는 정확히 9개(`PreToolUse` `PostToolUse` `UserPromptSubmit` `Stop`
`SubagentStop` `Notification` `PreCompact` `SessionStart` `SessionEnd`)이고, **답변이 쓰이는
도중에 걸리는 훅은 없습니다.** 그래서 "출력 직전 가로채기"는 불가능하고, 생성 전과 종료 후
양쪽에서 조이는 것이 실제로 가능한 최선입니다.

### 설치

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

한 세션만 끄기: `HANJA_GUARD=off claude`

### 오탐을 피하는 방법

이런 도구는 오탐이 나는 순간 짜증나서 지우게 됩니다. 그래서 다음은 전부 통과시킵니다.

- **내가 프롬프트에 쓴 문자** — `日経平均 시황 써줘`라고 물으면 1층은 침묵하고 2층도 `日経平均`을 허용. 같은 답변의 `上昇`은 여전히 차단.
- **한국어가 아닌 턴** — 프롬프트에 한글이 없으면 1층은 주입하지 않음(영어 세션은 비용 0)
- **코드블록·인라인 코드** — `print('中文')`은 건드리지 않음
- **thinking 블록** — 화면에 보이는 답변 텍스트만 검사
- **서브에이전트 출력** — sidechain 레코드는 무시
- **`.hanja-guard.json`의 `allow` 목록**

그리고 `maxRetries`(기본 2회)를 넘으면 무한 루프 대신 경고만 남기고 포기합니다.

### 설정

프로젝트 루트에 `.hanja-guard.json`(또는 전역은 `~/.hanja-guard.json`):

```json
{
  "prevent": true,
  "detect": ["hanja", "punct", "kana"],
  "allow": ["日経平均", "上海"],
  "maxRetries": 2
}
```

`detect`에 `kana`를 넣으면 히라가나·가타카나도 잡습니다(기본 꺼짐).
`prevent: false`로 두면 1층 없이 2층 교정만 씁니다.

### 한계

- **1층은 잠금이 아니라 유도입니다.** 확률을 낮출 뿐 오염을 불가능하게 만들지는 못합니다. 그래서 2층이 있습니다.
- **2층은 출력 "직후" 교정입니다.** 답변은 생성되는 대로 터미널에 스트리밍되고 그 사이에 걸리는 훅이 없습니다. 1층이 놓치면 오염된 답변이 잠깐 보이고, 곧바로 교정본이 나옵니다.
- 2층이 작동하면 답변이 한 번 더 생성되므로 토큰을 조금 더 씁니다.
- **문자 종류만 봅니다.** "한글로만 쓰인 어색한 번역투"는 잡지 못합니다.
- 터미널 답변만 검사하고, 파일에 쓰인 한자는 검사하지 않습니다.

---

MIT © [muju0629](https://github.com/muju0629)
