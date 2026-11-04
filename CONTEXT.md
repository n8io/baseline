# Building baseline: the shared packages, the app template, and the projects made from it.

## Language

**Package**:
One of the shared `@n8io/baseline-*` libraries in `packages/`, versioned and published on its own and installed by Projects. Each wraps one concern, such as cache or queue, and holds no business rules.
_Avoid_: lib, shared module, shared code

**Template**:
`apps/app`, the app every Project is made from, with Foo as its example Domain. Its versions are the `app@x.y.z` tags.
_Avoid_: boilerplate, scaffold, skeleton

**Project**:
A repo made from the Template by `app-create`. It owns its code from then on, depends on Packages, runs `app-ci.yml`, and takes newer Template releases by Template upgrade.
_Avoid_: generated repo, child repo, downstream repo

**Release**:
Merging the "Version packages" PR. It publishes each Package with a changeset and tags `app@x.y.z` when the Template changed; the next push then moves `v<major>` of `app-ci.yml` to the newest `app@` tag.
_Avoid_: deploy, version bump, drop

**Template upgrade**:
Bringing a Project to a newer Template release with `pnpm template-upgrade`: a 3-way merge between the release the Project came from and the new one, where you resolve each conflict by hand.
_Avoid_: template sync, template update, rebase onto the template
