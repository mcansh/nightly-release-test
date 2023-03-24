# nightly-release-test

This is a test repository for a few things:

1. the comment bot that [Remix][remix] and [React Router][react_router] use to automatically comment on issues and pull requests when a new release goes out (see [this pr][pr] and [this issue][issue] for an example)
2. tests a nightly release workflow that automatically publishes a new version of the package every night at midnight (see [this workflow][nightly] for more details) and then comments on them

[react_router]: https://github.com/remix-run/react-router
[remix]: https://github.com/remix-run/remix
[pr]: https://github.com/mcansh/nightly-release-test/pull/182
[issue]: https://github.com/mcansh/nightly-release-test/issues/183
[nightly]: ./.github/workflows/nightly.yml
