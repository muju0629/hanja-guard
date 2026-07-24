# hanja-guard 🛡

**Claude의 한국어 답변이 읽기 어려우면, 다시 쓰게 만듭니다.**

한자가 섞이거나, 글자가 깨지거나, 쓸데없이 어려운 말을 쓰거나, 설명 없이 전문용어를 던지면 잡아냅니다.

[English ↓](#english)

```
나:      이거 정리해줘
Claude:  하나의 순환 구조로 묶어야 한다는 게 골자다.
         기본은 꿐져 두고 CJK 범위 regex를 고쳤다.

         └─ 🛡 hanja-guard: 감지 (꿐 골자 CJK regex) → 다시 쓰기 요청 1/2
            · 깨진 글자: 꿐 → 오타이니 올바른 낱말로 고치세요.
            · 어려운 말: 골자 → 누구나 아는 쉬운 말로 바꾸세요.
            · 설명 없는 전문용어: CJK, regex → 괄호로 한 줄 설명을 붙이세요.

Claude:  하나의 순환 구조로 묶어야 한다는 게 요점이다.
         기본은 꺼져 두고, 한자를 찾는 규칙(정규식)을 고쳤다.
```

인공지능을 부르지도, 다른 프로그램을 깔지도 않습니다 — `Stop` 훅에서 도는 Node 스크립트 하나입니다.
대화 내용에 **0 토큰**을 더합니다.

---

## 무엇을 잡나

| 검사 | 잡는 것 | 기본값 |
|---|---|---|
| `hanja` | 한자 — `上昇`, `这是一个测试` | 켜짐 |
| `punct` | 중국어 문장부호 — `결과，확인` | 켜짐 |
| `broken` | **깨진 글자** — `꿐`, `뷁`, `` | 켜짐 |
| `hard` | **어려운 한자어** — `골자`, `제고`, `방증` | 꺼짐 |
| `jargon` | **설명 없는 전문용어** — `CJK`, `정규식`, `훅` | 꺼짐 |
| `kana` | 일본 글자 — `こんにちは` | 꺼짐 |

`hard`와 `jargon`은 사람마다 기준이 달라서 기본은 꺼둡니다. 아래 설정에서 켜세요.

### 깨진 글자는 어떻게 아나

한글로 만들 수 있는 글자는 11,172자이지만, **실제로 쓰이는 건 2,350자**입니다(KS X 1001, 한국 산업 표준). 그 밖의 글자가 나오면 거의 항상 오타이거나 글자가 망가진 것입니다.

```
꿐 뷁     → ❌ 표준에 없음 (오타)
꺼 몫 부엌 읊 앉 → ✅ 정상 (어려운 글자도 통과)
```

실제 한국어 문서 **211개, 124만 자**에 돌려서 **잘못 잡은 건 0건**이었습니다.

---

## 설치

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

끝입니다. Node 18 이상이 필요한데, Claude Code에 이미 들어 있습니다.

한 번만 끄고 쓰려면: `HANJA_GUARD=off claude`

---

## 먼저 이것부터 확인하세요

한자만 문제라면 Claude Code에 이미 기능이 있습니다. `settings.json`에:

```json
{ "language": "korean" }
```

이걸 켜면 "항상 한국어로 답하라"는 지시가 들어갑니다. **이것부터 켜세요.**

|  | `{"language": "korean"}` | hanja-guard |
|---|---|---|
| 방식 | 답을 만들기 전 **지시** | 답을 만든 뒤 **검사** |
| 어겼을 때 | 아무 일도 일어나지 않음 | 다시 쓰게 만듦 |

내장 설정은 부탁이고, 이건 검사입니다. 둘은 대체재가 아니라 순서입니다.

---

## 어떻게 동작하나

두 군데에서 검사합니다.

**1. 답변이 끝난 뒤** — `Stop` 훅(답변이 끝날 때 실행되는 프로그램)이 방금 나온 답변을 읽고, 문제를 찾으면 `{"decision":"block"}`을 돌려줍니다. Claude가 **같은 자리에서** 답변을 다시 씁니다.

**2. 도구를 실행하기 직전** — `PreToolUse` 훅이 도구에 넘길 내용을 미리 검사합니다. 깨진 글자가 있으면 실행을 막고 고치게 합니다. 파일에 쓰는 내용, 질문 상자에 띄우는 글이 여기 해당합니다.

```
답변 글    : 만들어지는 대로 화면에 나감 → 나온 뒤에 고침
도구 내용물 : 실행 전에 검사 가능        → 보이기 전에 막음
```

**도구 내용물에는 `깨진 글자`만 검사합니다.** 한자 검사를 걸면 안 됩니다 — 코드에 중국어 문자열을 넣는 건 정상 작업이고, 이 플러그인 자기 파일에도 시험용 `上昇`이 들어 있어서 **플러그인을 고치는 것 자체가 막혀버립니다.**

작업이 멈추는 일은 없습니다. 같은 세션에서 2번 막고도 안 고쳐지면 3번째는 그냥 통과시킵니다.

---

## 잘못 잡지 않으려고 한 것

이런 도구는 멀쩡한 걸 잡는 순간 짜증나서 지우게 됩니다. 그래서 이것들은 통과시킵니다.

**1. 내가 물어본 말.** 그 답변에서는 허용됩니다. `日経平均 시황 써줘`라고 물으면 답변의 `日経平均`은 통과하고, 같은 답변의 `上昇`은 여전히 걸립니다.

**2. 코드.** 코드 블록과 코드 표시는 검사 전에 빼냅니다. `print('中文')`은 건드리지 않습니다.

**3. 다른 낱말의 일부.** 한국어는 낱말이 붙어서 늘어나기 때문에 그냥 찾으면 틀립니다.

```
대조 대상이 아니라   → 상이 ❌ 안 잡음 (대상 + 이)
전통적 비수기인 데다 → 기인 ❌ 안 잡음 (비수기 + 인)
임상 2·3상이 진행   → 상이 ❌ 안 잡음 (3상 + 이)
계절성에 기인한다   → 기인 ✅ 잡음  (낱말 첫머리)
```

**4. 이미 설명한 전문용어.** `정규식(글자를 찾는 규칙)`처럼 괄호로 풀어썼으면 통과합니다.

**5. 내가 정한 예외 목록.** 아래 참고.

그리고 무한 반복에 빠지지 않습니다 — 정해진 횟수만큼 고쳐도 남으면 경고만 남기고 멈춥니다.

---

## 설정

`~/.hanja-guard.json`(전체) 또는 프로젝트 폴더의 `.hanja-guard.json`:

```json
{
  "detect": ["hanja", "punct", "broken", "hard", "jargon"],
  "allow": ["日経平均", "上海", "똠양꿍"],
  "maxRetries": 2
}
```

| 항목 | 기본값 | 뜻 |
|---|---|---|
| `enabled` | `true` | 전체 켜고 끄기 |
| `detect` | `["hanja","punct","broken"]` | 위 표의 검사 이름 중 골라서 |
| `allow` | `[]` | 항상 통과시킬 말 |
| `maxRetries` | `2` | 포기하기 전 다시 쓰기 횟수 |

프로젝트 설정이 전체 설정을 덮어씁니다. 환경변수 `HANJA_GUARD=off`가 둘 다 덮어씁니다.

**`hard` 목록은 당신 분야에 맞게 고치세요.** 예를 들어 바이오 글에서는 `저해제`, `유전자 발현`이 정확한 용어이므로 기본 목록에서 빼두었습니다. 금융 글이라면 `상회`, `하회`가 정상이니 넣지 마세요. 목록은 `hooks/guard.mjs`의 `HARD_WORDS`에 있습니다.

---

## 토큰을 얼마나 더 쓰나 (실측)

결국 중요한 건 "귀찮음을 줄이는 대가로 얼마를 더 내느냐"입니다. 추정하지 않고 실제로 쟀습니다.

### 평소: 0 토큰

훅은 대화 내용에 들어가지 않습니다. 플러그인을 깔기 전과 후의 대화 크기가 **똑같습니다.**

```
$ claude plugin details hanja-guard
  Always-on:   ~0 tok   added to every session

실측: 플러그인 있을 때도 없을 때도 대화 크기 18,785 토큰으로 동일
```

**검사에 걸리지 않는 답변은 비용이 0원입니다.** 이게 이 도구의 핵심입니다.

### 교정이 발동할 때: 1턴 추가

같은 질문을 검사만 켜고 꺼서 비교했습니다.

| | 검사 끔 | 검사 켬 (발동) | 차이 |
|---|---|---|---|
| 턴 수 | 1 | 2 | **+1** |
| 출력 토큰 | 4 | 325 | **+321** |
| 비용 | $0.1791 | $0.2072 | **+$0.028 (+15.7%)** |

다시 쓰라는 지시문은 **195자**입니다. 답변을 한 번 더 만드는 비용이 대부분을 차지합니다.

> 이건 **가장 나쁜 경우**입니다. 일부러 "한자로만 써줘"라고 시켜놓고 검사를 켠 것이라, 검사가 사용자 의도와 싸우다가 2번 막고 포기했습니다. 보통은 `上昇`을 `상승`으로 바꾸는 정도라 답변 길이만큼만 더 듭니다.

### 도구 실행을 막을 때: 훨씬 쌈

답변을 다시 만들지 않고 도구 호출만 다시 하므로 비용이 훨씬 적습니다. 지시문은 약 80자입니다.

실행 시간은 **도구 호출 1회당 58밀리초** 늘어납니다(20회 평균). 파일 하나 읽고 쓰는 정도에서는 체감되지 않습니다.

### 아직 모르는 것

**얼마나 자주 발동하는지는 재지 못했습니다.** 이게 사실 제일 중요한 숫자인데, 며칠 실제로 써봐야 나옵니다. 참고로 실제 한국어 문서 211개에서 `어려운 말`이 들어 있던 건 **9개(4.3%)**, `깨진 글자`는 **0개**였습니다.

발동 빈도가 10%라면 전체 비용은 대략 1.5% 늘어납니다. 20%면 3% 정도입니다. 직접 써보시고 체감이 다르면 [알려주세요](https://github.com/muju0629/hanja-guard/issues).

### 아껴 쓰는 법

- `detect`에서 필요 없는 검사를 빼면 발동 자체가 줄어듭니다
- 자주 걸리는 말은 `allow`에 넣으세요
- `maxRetries`를 `1`로 낮추면 최대 비용이 절반이 됩니다

---

## 직접 확인해보기

```bash
node hooks/guard.mjs --selftest
```

```
PASS  중국어 섞인 답변 [上 昇]
PASS  깨진 음절 (꿐져) [꿐]
PASS  올바른 음절 (꺼져)
PASS  받침 어려운 정상 단어
PASS  어려운 말 (골자) [골자]
PASS  낱말 일부 (대상이)
PASS  숫자 뒤 (임상 3상이)
PASS  설명 없는 전문용어 [CJK regex]
PASS  괄호로 설명함
...
27/27 passed
```

---

## 한계

깔기 전에 알아두면 좋은 것들.

- **답변 글은 나온 "뒤"에 고칩니다.** Claude Code가 부를 수 있는 훅은 9가지인데, 답변이 쓰이는 도중에 걸리는 건 없습니다. 글자는 만들어지는 대로 화면에 나오기 때문에 중간에 막을 수 없습니다. 잘못된 답이 잠깐 보이고, 곧바로 고친 답이 나옵니다. (도구에 넘기는 내용은 예외로, 실행 전에 막을 수 있습니다.)
- **고칠 때 답변을 한 번 더 만듭니다.** 그만큼 비용이 조금 더 듭니다.
- **어색한 문장은 못 잡습니다.** 한글로만 쓰였는데 번역한 것처럼 어색한 문장은 규칙으로 못 찾습니다. 이건 앞으로도 어려울 것 같습니다.
- **드문 외래어는 잘못 잡을 수 있습니다.** `똠`처럼 표준에 없는 글자를 쓰는 말이 있습니다. `allow`에 넣으면 됩니다.
- **화면에 나온 답변만 봅니다.** Claude가 *파일에* 쓴 내용은 검사하지 않습니다.

---

# English

**Makes Claude rewrite its Korean answers when they are hard to read.**

Catches Chinese characters, broken syllables, needlessly hard Sino-Korean vocabulary, and jargon thrown out without explanation.

```
You:     이거 정리해줘
Claude:  …게 골자다. 기본은 꿐져 두고 CJK 범위 regex를 고쳤다.
         └─ 🛡 detected: 꿐 (broken syllable), 골자 (hard word), CJK/regex (unexplained)
Claude:  …게 요점이다. 기본은 꺼져 두고, 한자를 찾는 규칙(정규식)을 고쳤다.
```

One Node script on two hooks. No API calls, no dependencies, **0 tokens** of context.

**Two checkpoints.** A `Stop` hook reads the finished answer and returns `{"decision":"block"}` so Claude rewrites it. A `PreToolUse` hook inspects tool arguments *before* the tool runs — file contents, prompt-dialog text — and refuses broken syllables before anyone sees them. Answer text streams straight to the terminal so it can only be fixed afterwards; tool arguments can be stopped in advance.

Only the `broken` check runs on tool arguments. Hanja must not: writing Chinese into a file is often deliberate, and this plugin's own test cases contain 上昇 — checking hanja on `Write` would make the plugin uneditable. Work never wedges either: after two refusals in a session the third call goes through.

### What it checks

| Check | Catches | Default |
|---|---|---|
| `hanja` | Chinese characters — 上昇 | on |
| `punct` | Full-width punctuation — 결과，확인 | on |
| `broken` | Broken syllables — 꿐, 뷁,  | on |
| `hard` | Hard Sino-Korean words — 골자, 제고 | off |
| `jargon` | Unexplained jargon — CJK, regex | off |
| `kana` | Japanese kana — こんにちは | off |

**How broken syllables are detected:** Korean can form 11,172 syllables, but only **2,350 are actually used** (KS X 1001, the Korean industrial standard). Anything outside that set is nearly always a typo or mojibake. Measured against **211 real Korean documents (1.24M characters): zero false positives.**

### Install

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

Requires Node 18+ (Claude Code ships with it). Disable for one session: `HANJA_GUARD=off claude`.

### Try the built-in setting first

Claude Code already has `{"language": "korean"}` in `settings.json`, which injects *"Always respond in korean…"* into the system prompt. Turn that on first — it handles the common case.

The built-in setting is an **instruction** before generation; hanja-guard is an **inspection** after it. Nothing verifies the instruction, which is the gap this fills.

### Avoiding false positives

1. **Anything you typed** — whitelisted for that turn.
2. **Code** — fenced blocks and inline code are stripped before scanning.
3. **Substrings of other words** — Korean agglutinates, so `대상이` must not match `상이`. Words are only counted where they *start* a word.
4. **Already-explained jargon** — `정규식(글자를 찾는 규칙)` passes.
5. **Your allowlist** — `.hanja-guard.json`:

```json
{ "detect": ["hanja", "punct", "broken", "hard", "jargon"], "allow": ["日経平均"], "maxRetries": 2 }
```

**Tune `HARD_WORDS` to your field.** `저해`/`발현` were removed from the defaults because *저해제* (inhibitor) and *유전자 발현* (gene expression) are correct biotech terms.

### What it costs (measured, not estimated)

**When nothing is flagged: zero.** Hooks never enter the context — conversation size is byte-identical with and without the plugin installed (18,785 tokens either way), and `claude plugin details` reports `Always-on: ~0 tok`.

**When a rewrite fires**, measured by running the same prompt with checks off and on:

| | checks off | checks on (fired) | delta |
|---|---|---|---|
| Turns | 1 | 2 | **+1** |
| Output tokens | 4 | 325 | **+321** |
| Cost | $0.1791 | $0.2072 | **+$0.028 (+15.7%)** |

The rewrite instruction itself is 195 characters; regenerating the answer is the bulk of it. That run is a **worst case** — the prompt deliberately demanded hanja, so the guard fought the request, refused twice, then gave up.

**When a tool call is refused**, cost is much lower: only the tool call is retried, not the whole answer. Runtime overhead is **58 ms per tool call** (mean of 20).

**Not yet measured: how often it fires.** That is the number that actually settles the tradeoff and it needs real-world days. For reference, across 211 real Korean documents, `hard` matched 9 (4.3%) and `broken` matched 0. At a 10% fire rate the overall bill rises roughly 1.5%.

To spend less: drop unused checks from `detect`, add frequent flags to `allow`, or set `maxRetries` to `1` to halve the worst case.

### Test it

```bash
node hooks/guard.mjs --selftest    # 27/27 passed
```

### Limitations

- **It corrects *after* the fact.** Claude Code has nine hook events and none fire while an answer is being written. You see the bad answer for a moment, then the corrected one.
- **A rewrite costs one extra turn.**
- **Awkward phrasing is not detectable** — translation-flavored Korean written entirely in Hangul passes.
- **Rare loanwords can false-positive** — `똠` (as in 똠양꿍) is outside the standard set. Add it to `allow`.
- **Terminal answers only** — text written *into files* is not checked.

---

MIT © [muju0629](https://github.com/muju0629)
