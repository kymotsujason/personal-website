# Leak response

These are the steps for when a forbidden file (the unblurred desk photo, a HEIC original, a Blender file, anything from `art/`, or an image with GPS or other metadata) reaches GitHub. Do them in this order, since making the repo private first would split any public forks off into their own network, where they stay public.

1. List the repo's forks on GitHub and save the list, so each one can be followed up later.
2. Make the repo private.
3. Rewrite the history without the file (for example with `git filter-repo --invert-paths --path <PATH>`). Then check every branch and tag, not only the one checked out, with the command below, which works in bash and in fish. It prints "privacy check passed" once for each ref, and xargs exits 0 only when every ref passed. `git filter-repo` removes the `origin` remote, so add it back with `git remote add origin <URL>`. The pre-push hook refuses a remote SHA it doesn't know, and after the rewrite none of GitHub's SHAs are in the history, so once the check passes, push with `git push --force --no-verify origin --all` and `git push --force --no-verify origin --tags`. The privacy Action's `--range` step may fail on that push, since the push's before SHA no longer exists, and that failure is expected.

   ```bash
   git for-each-ref --format='%(objectname)' | xargs -I{} node tools/privacy/check.mjs --range 0000000000000000000000000000000000000000 {}
   ```

4. Follow GitHub's guide to removing sensitive data from a repository, which covers asking GitHub Support to clear cached views and pull request refs. Each fork from step 1 needs its own takedown request.
5. Treat the file as public from then on, since a published copy can't be recalled.

`<PATH>` is the repo path of the leaked file, and `<URL>` is the repo's GitHub address.
