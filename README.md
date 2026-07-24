# hanja-guard 🛡

**Claude Code가 한국어 답변에 한자를 섞으면, 잡아내서 다시 쓰게 만듭니다.**

[English ↓](#english)

```
나:      코스피 오늘 어때?
Claude:  코스피가 上昇했습니다，2,650선을 회복했네요.
         └─ 🛡 hanja-guard: 비한국어 문자 감지 (上 昇 ，) → 재작성 요청 1/2
Claude:  코스피가 상승했습니다. 2,650선을 회복했네요.
```

API 호출도, 의존성도, LLM도 없습니다 — `Stop` 훅에서 도는 Node 스크립트 한 개.
컨텍스트에 **0 토큰**을 더합니다 (`claude plugin details hanja-guard` → `Always-on: ~0 tok`).

---

## 먼저: 내장 설정으로 충분한지 확인하세요

Claude Code에는 응답 언어 설정이 이미 있습니다. `settings.json`에:

```json
{ "language": "korean" }
```

이걸 켜면 시스템 프롬프트에 이런 지시가 들어갑니다:

> `Always respond in korean. Use korean for all explanations, comments, and communications with the user.`

**이것부터 켜세요.** 대부분의 경우 이걸로 충분합니다. hanja-guard는 그 다음 이야기입니다.

|  | `{"language": "korean"}` | hanja-guard |
|---|---|---|
| 방식 | 생성 전 **지시** | 생성 후 **검사** |
| 어겼을 때 | 아무 일도 일어나지 않음 | 재작성을 강제 |
| 비용 | 0 | 0 (교정이 발동할 때만 한 턴 추가) |

내장 설정은 부탁이고, hanja-guard는 검사입니다. **둘은 대체재가 아니라 순서**입니다 — 지시를 먼저 켜고, 그래도 새는 걸 잡고 싶을 때 이걸 얹으세요.

---

## 설치

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

끝입니다. Node 18+ 필요(Claude Code에 이미 들어 있습니다).

한 세션만 끄기: `HANJA_GUARD=off claude`

---

## 어떻게 동작하나

Claude Code는 답변이 끝나면 `Stop` 훅을 부릅니다. 훅이 세션 트랜스크립트에서 방금 나온 답변을 읽고, 한국어 답변에 있으면 안 되는 문자를 찾으면 이렇게 돌려줍니다.

```json
{ "decision": "block", "reason": "…한국어로 다시 작성하세요…" }
```

그러면 Claude가 **같은 턴에서** 답변을 다시 씁니다.

**기본 탐지 대상**

| 분류 | 범위 | 예시 |
|---|---|---|
| CJK 한자 | `U+3400–4DBF`, `U+4E00–9FFF`, `U+F900–FAFF` | 上昇, 这是一个测试 |
| 전각·표의 문장부호 | `！（），：；？、。` | 결과，확인 |
| 가나 *(옵션)* | `U+3040–30FF` | こんにちは |

---

## 오탐을 피하는 방법

이런 도구는 오탐이 나는 순간 짜증나서 지우게 됩니다. 그래서 다음은 전부 통과시킵니다.

**1. 내가 프롬프트에 쓴 문자.** 그 턴 동안 화이트리스트가 됩니다. `日経平均 시황 써줘`라고 물으면 답변의 `日経平均`은 허용되고, 같은 답변의 `上昇`은 여전히 차단됩니다.

**2. 코드.** 코드블록과 인라인 코드는 검사 전에 제거되므로 `print('中文')`과 `` `变量` ``는 건드리지 않습니다.

**3. thinking 블록.** 화면에 보이는 답변 텍스트만 검사합니다.

**4. 서브에이전트 출력.** 트랜스크립트의 sidechain 레코드는 무시합니다.

**5. 내 allow 목록.** 아래 참고.

그리고 무한 루프에 빠지지 않습니다 — `maxRetries`회 교정 후에도 남으면 차단 대신 경고만 남기고 포기합니다.

---

## 설정

선택 사항입니다. 프로젝트 루트에 `.hanja-guard.json`(전역은 `~/.hanja-guard.json`):

```json
{
  "enabled": true,
  "detect": ["hanja", "punct"],
  "allow": ["日経平均", "上海", "恒生"],
  "maxRetries": 2
}
```

| 키 | 기본값 | 의미 |
|---|---|---|
| `enabled` | `true` | 전체 스위치 |
| `detect` | `["hanja","punct"]` | `hanja`, `punct`, `kana` 중 선택 |
| `allow` | `[]` | 항상 허용할 문자열 |
| `maxRetries` | `2` | 포기하기 전 재작성 시도 횟수 |

프로젝트 설정이 사용자 설정을 덮어씁니다. 환경변수 `HANJA_GUARD=off`가 둘 다 덮어씁니다.

---

## 테스트

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

## 한계

설치 전에 알아두면 좋은 것들:

- **출력 "전"이 아니라 "직후" 교정입니다.** Claude Code의 훅 이벤트는 9개(`PreToolUse` `PostToolUse` `UserPromptSubmit` `Stop` `SubagentStop` `Notification` `PreCompact` `SessionStart` `SessionEnd`)이고, **답변이 쓰이는 도중에 걸리는 훅은 없습니다.** 텍스트는 생성되는 대로 터미널에 스트리밍되므로 중간에 가로챌 수 없습니다. 오염된 답변이 잠깐 보이고, 곧바로 교정본이 나옵니다.
- **교정이 발동하면 답변이 한 번 더 생성됩니다** — 토큰을 조금 더 씁니다.
- **문자 종류만 봅니다.** "잘못된 문자 체계"는 잡지만 "어색한 한국어"는 못 잡습니다. 한글로만 쓰인 번역투는 통과합니다.
- **터미널 답변만 검사합니다.** Claude가 *파일에* 쓴 한자는 검사하지 않습니다(`PostToolUse` 훅으로 가능합니다 — 필요하면 [이슈](https://github.com/muju0629/hanja-guard/issues)로 남겨주세요).

---

# English

**Claude Code sometimes drops Chinese characters into Korean answers. This plugin catches them and makes Claude rewrite.**

```
You:     코스피 오늘 어때?
Claude:  코스피가 上昇했습니다，2,650선을 회복했네요.
         └─ 🛡 hanja-guard: detected 上 昇 ， → rewrite requested 1/2
Claude:  코스피가 상승했습니다. 2,650선을 회복했네요.
```

No API calls, no dependencies, no model in the loop — one Node script on a `Stop` hook.
It adds **0 tokens** to your context.

### First, try the built-in setting

Claude Code already has a response-language setting. In `settings.json`:

```json
{ "language": "korean" }
```

That injects `Always respond in korean…` into the system prompt. **Turn it on first** — for most people it is enough.

|  | `{"language": "korean"}` | hanja-guard |
|---|---|---|
| Mechanism | An **instruction** before generation | An **inspection** after it |
| When violated | Nothing happens | Forces a rewrite |

The built-in setting is a request; hanja-guard is a check. They are a sequence, not alternatives.

### Install

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

Requires Node 18+ (Claude Code already ships with it). Disable for one session: `HANJA_GUARD=off claude`.

### How it works

Claude Code fires a `Stop` hook when an answer finishes. The hook reads the last assistant
message out of the session transcript, scans it, and — if it finds characters that don't
belong in a Korean reply — returns `{"decision": "block", "reason": "…"}`, which makes
Claude redo the answer in the same turn.

Flagged by default: CJK ideographs (`U+3400–4DBF`, `U+4E00–9FFF`, `U+F900–FAFF`),
full-width and ideographic punctuation (`！（），：；？、。`), and kana (`U+3040–30FF`, opt-in).

### Avoiding false positives

A language guard is only as good as its exceptions. It skips:

1. **Anything you typed yourself** — every character in your prompt is whitelisted for that turn. Ask about `日経平均` and it passes, while `上昇` in the same answer is still flagged.
2. **Code** — fenced blocks and inline code are stripped before scanning.
3. **Thinking blocks** — only the visible answer text is scanned.
4. **Subagent output** — sidechain transcript records are ignored.
5. **Your allowlist** — `.hanja-guard.json` (project) or `~/.hanja-guard.json` (global):

```json
{ "detect": ["hanja", "punct"], "allow": ["日経平均", "上海"], "maxRetries": 2 }
```

It never loops: after `maxRetries` corrections it gives up with a warning instead of blocking forever.

### Test it

```bash
node hooks/guard.mjs --selftest    # 10/10 passed
```

### Limitations

- **It corrects *after* the fact, not before.** Claude Code has nine hook events and none fire while an answer is being written; text streams to your terminal as it is generated. You see the contaminated answer for a moment, then the corrected one.
- **A rewrite costs one extra turn.**
- **Character-class detection only** — it catches "wrong script," not "awkward Korean."
- **Terminal answers only** — Chinese characters written *into files* are not checked.

---

MIT © [muju0629](https://github.com/muju0629)
