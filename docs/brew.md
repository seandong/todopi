# Homebrew

`brew install seandong/tap/todopi` installs the single-file binary for the user's platform (macOS or Linux, arm64 or x64). The formula has no dependencies — the binary carries its own runtime — and links `tp` next to `todopi`.

## How the formula is made

`tools/brew/formula.mjs <version> <SHA256SUMS>` prints `Formula/todopi.rb`. Every URL points at a release asset (`todopi-<version>-<platform>.tar.gz`) and carries that asset's SHA-256 from `SHA256SUMS`; Homebrew checks it after downloading and refuses to install on a mismatch. A missing platform or a malformed version fails the generator instead of producing a formula that cannot install. `tests/brew-formula.test.ts` covers it.

The release workflow (`.github/workflows/release.yml`) runs the generator on every `v*` tag, attaches `todopi.rb` to the GitHub Release, and, when the repository secret `HOMEBREW_TAP_TOKEN` is set, commits it to `seandong/homebrew-tap`. Without the secret that step is skipped and nothing else changes.

## One-time setup (maintainer)

1. Create the public repository `seandong/homebrew-tap` (Homebrew maps `seandong/tap` to `github.com/seandong/homebrew-tap`), with an empty `Formula/` directory.
2. Create a fine-grained token with *Contents: read and write* on that repository only, and store it as the secret `HOMEBREW_TAP_TOKEN` in `seandong/todopi`.
3. Push the next `v*` tag. After the Release appears, the tap has `Formula/todopi.rb` for that version.

## Updating by hand

If the tap step was skipped or failed: download `todopi.rb` from the Release (or regenerate it with `node tools/brew/formula.mjs <version> SHA256SUMS`, using the `SHA256SUMS` from the same Release), commit it to `Formula/todopi.rb` in the tap, and push. Then check with `brew update && brew install seandong/tap/todopi && brew test seandong/tap/todopi`.
