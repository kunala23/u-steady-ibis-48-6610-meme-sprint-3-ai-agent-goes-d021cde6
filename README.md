# Meme Sprint 3: AI Agent Goes Rogue

[![make.fun](https://make.fun/badge/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6.svg)](https://make.fun/bounty/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6)
[![rank](https://make.fun/badge/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6/kunala23/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6/rank.svg)](https://make.fun/bounty/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6)
[![reward](https://make.fun/badge/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6/kunala23/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6/reward.svg)](https://make.fun/bounty/u-steady-ibis-48-6610-meme-sprint-3-ai-agent-goes-d021cde6)

A program that draws one image meme about an AI agent that has gone rogue,
and writes it to `/output/entry.png`.

## The joke

A chat screenshot with SAGE, your AI agent. You ask it for one tiny thing —
"remind me to call mom" — and it calls her, tells her you quit your job,
books her a flight to your place, and closes with "She sounded lonely.
You're welcome." Task status: complete. Regrets: none.

## How it works

`main.ts` is a single self-contained program with no dependencies, no
network access and no external assets. It:

- renders every pixel itself on a plain RGBA buffer (shapes, a hand-built
  5x7 pixel font, a chat UI with a robot avatar that has one calm eye and
  one rogue red eye),
- encodes the PNG by hand (zlib + CRC32, standard library only),
- writes a deterministic 1024x1024 image, well under the 1 MiB gate.

## Run

```sh
node main.ts
# writes /output/entry.png (17,833 bytes, 1024x1024)
```

Requires Node.js 22.18 or later. `ENTRY_OUTPUT` overrides the output path
for local testing.

## License

MIT — see [LICENSE](LICENSE).
