<div align="center">

# hanja-guard 🛡

**Claude keeps slipping Chinese characters into Korean answers. This fixes them automatically.**

[![version](https://img.shields.io/badge/version-0.5.1-1B2A5B)](https://github.com/muju0629/hanja-guard/releases)
[![context cost](https://img.shields.io/badge/context%20cost-0%20tokens-brightgreen)](#what-it-costs)
[![tests](https://img.shields.io/badge/tests-27%2F27-success)](#try-it)
[![node](https://img.shields.io/badge/node-%E2%89%A518-informational)](#install)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

[한국어](README.md)

</div>

---

```
You:     코스피 오늘 어때?

Claude:  코스피가 上昇했습니다，2,650선을 회복했네요.
         🛡 hanja-guard: detected 上 昇 ， → rewrite requested

Claude:  코스피가 상승했습니다. 2,650선을 회복했네요.
```

Claude Code already has `"language": "korean"` in `settings.json`, and it still leaks. That setting is an **instruction** — nothing happens when it's ignored. This is a **check**.

<br>

## Install

```
/plugin marketplace add muju0629/hanja-guard
/plugin install hanja-guard@hanja-guard
```

That's it. Nothing to configure, and not a single token enters your context.

Turn it off for a session with `HANJA_GUARD=off claude`.

<br>

## What it catches

```diff
- 코스피가 上昇했습니다              Chinese characters
- 결과，확인했습니다                 full-width punctuation
- 기본은 꿐져 두고 씁니다             broken syllable  ← should be 꺼져
+ 코스피가 상승했습니다
```

Two more you can opt into:

```diff
- 하나로 묶는 게 골자다               needlessly hard vocabulary
- CJK 범위 regex가 깨졌습니다         jargon with no explanation
+ 하나로 묶는 게 요점이다
+ 한자를 찾는 규칙(정규식)이 깨졌습니다
```

<br>

## How broken syllables are detected

Korean can form 11,172 syllables. Only **2,350 are actually used** — they're enumerated in `KS X 1001`, the Korean industrial standard. Anything outside that set is nearly always a typo or mojibake.

```
꿐  뷁  큵        →  not in the standard. typo
꺼  몫  부엌  읊   →  fine, however exotic they look
```

That list is the published standard, not my guess. Run against **211 real Korean documents (1.24M characters): zero false positives.**

<br>

## What it costs

Short version: **free when nothing is flagged, one extra answer when something is.**

Measured by running the same prompt twice, checks off and on:

|  | checks off | checks on | |
|---|---|---|---|
| Context size | 18,785 tokens | 18,785 tokens | **identical** |
| Cost when flagged | $0.1791 | $0.2072 | +15.7% |

Hooks never enter the context, so an answer that passes genuinely costs nothing. Only a flagged answer gets regenerated.

That measurement is a worst case — the prompt demanded hanja outright, so the guard argued with it until the retry cap. A normal fix like `上昇` → `상승` is cheaper.

> How *often* it fires isn't measured yet. That takes real-world days — [tell me](https://github.com/muju0629/hanja-guard/issues) if your experience differs.

<br>

## Why I built it

Writing Korean market copy with Claude, `美 증시` and `上昇` kept showing up. Turns out Korean financial journalism writes that way — counting my own document folder, 21 of 44 files contain hanja, and `美` alone appears 1,887 times. Claude learned it as the normal register for Korean market writing. Not a malfunction, just a style I didn't want.

Then Claude wrote `기본은 꿐져 두고` — `꿐져` where it meant `꺼져`. Hanja is a style disagreement; that one is just a typo, and I wasn't going to keep catching those by eye.

<br>

<details>
<summary><b>Configuration</b></summary>

<br>

`~/.hanja-guard.json` (global) or `.hanja-guard.json` in a project:

```json
{
  "detect": ["hanja", "punct", "broken", "hard", "jargon"],
  "allow": ["日経平均", "上海"],
  "maxRetries": 2
}
```

| Check | Catches | Default |
|---|---|---|
| `hanja` | Chinese characters | on |
| `punct` | Full-width punctuation | on |
| `broken` | Broken syllables | on |
| `hard` | Hard Sino-Korean words | off |
| `jargon` | Unexplained jargon | off |
| `kana` | Japanese kana | off |

`hard` and `jargon` are off by default — what counts as difficult depends on the reader.

**Tune `HARD_WORDS` to your field.** `저해` and `발현` were dropped from the defaults because *저해제* (inhibitor) and *유전자 발현* (gene expression) are correct biotech terms. The list lives in `hooks/guard.mjs`.

To spend less: drop unused checks, add frequent flags to `allow`, or set `maxRetries` to `1`.

</details>

<details>
<summary><b>Avoiding false positives</b></summary>

<br>

A guard like this gets uninstalled the first time it flags something correct.

**Anything you typed passes.** Ask about `日経平均` and it stays; `上昇` in the same answer still gets flagged.

**Code is skipped.** `print('中文')` is left alone.

**Substrings of other words don't count.** Korean agglutinates, so a naive match is wrong:

```
대조 대상이 아니라      →  상이 ❌  (대상 + 이)
전통적 비수기인 데다    →  기인 ❌  (비수기 + 인)
임상 2·3상이 진행      →  상이 ❌  (3상 + 이)
계절성에 기인한다      →  기인 ✅  (starts a word)
```

I missed this at first and got 36 hits on a real corpus, over half of them bogus. With the boundary rule it's 9, all genuine.

**Already-explained jargon passes** — `정규식(글자를 찾는 규칙)` is fine.

</details>

<details>
<summary><b>How it works</b></summary>

<br>

Two checkpoints.

**After an answer finishes** — a `Stop` hook reads it and returns `{"decision":"block"}` so Claude rewrites in the same turn.

**Before a tool runs** — a `PreToolUse` hook inspects the arguments: file contents, prompt-dialog text. Broken syllables are refused before anyone sees them.

```
answer text     :  streams to the terminal  →  fixed afterwards
tool arguments  :  inspectable in advance   →  stopped before display
```

Only the `broken` check runs on tool arguments. Hanja must not: Chinese string literals in code are normal, and this repo's own tests contain `上昇` — checking hanja on `Write` would make the plugin uneditable.

Work never wedges: after two refusals in a session, the third call goes through.

</details>

<details>
<summary><b>Limitations</b></summary>

<br>

**Answer text is fixed after the fact.** Claude Code has nine hook events and none fire mid-answer; text streams to the terminal as it's generated. You see the bad answer briefly, then the corrected one. (Tool arguments are the exception.)

**Awkward phrasing isn't detectable.** Translation-flavored Korean written entirely in Hangul passes.

**Rare loanwords can false-positive.** `똠` (as in 똠양꿍) is outside the standard set. Add it to `allow`.

**Text written into files isn't checked** — deliberately.

</details>

<br>

## Try it

```bash
node hooks/guard.mjs --selftest
```

```
PASS  중국어 섞인 답변 [上 昇]
PASS  깨진 음절 (꿐져) [꿐]
PASS  올바른 음절 (꺼져)
PASS  낱말 일부 (대상이)
PASS  숫자 뒤 (임상 3상이)
PASS  괄호로 설명함
...
27/27 passed
```

<br>

---

<div align="center">

Found a bug or a false positive? [Open an issue](https://github.com/muju0629/hanja-guard/issues).

MIT © [muju0629](https://github.com/muju0629)

</div>
