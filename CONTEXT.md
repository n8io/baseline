# Building baseline: the Packages, the Template, and the Projects made from it.

## Language

**Package**:
One of the shared `@n8io/baseline-*` libraries in `packages/`, versioned and published on its own and installed by Projects. Each wraps one concern, such as cache or queue, and holds no business rules. A change to one ships as a new version, not through a Template upgrade.
_Avoid_: shared lib, shared module, shared code

**Template**:
`apps/app`, the app every Project is made from, with `foo` as its example bounded context. Its versions are the `app@x.y.z` tags, and a Project's `.template.json` names the one it was made from or last upgraded to.
_Avoid_: boilerplate, scaffold, skeleton

**Project**:
A repo made from the Template by `app-create`, which renders it: a copy of `apps/app` without the example context, under the Project's name. It owns its code from then on, depends on Packages, runs `app-ci.yml`, and takes newer Template releases by Template upgrade.
_Avoid_: generated repo, child repo, downstream repo, baseline app

**Release**:
Merging the "Version packages" PR. It publishes each Package with a changeset and tags `app@x.y.z` when the Template changed; the same `release.yml` run then moves `v<major>` of `app-ci.yml` to the newest `app@` tag.
_Avoid_: version bump, deploy the Packages, drop a release

**Template upgrade**:
Bringing a Project to a newer Template release with `pnpm template-upgrade`: a 3-way merge between the release the Project came from and the new one, where you resolve each conflict by hand.
_Avoid_: template sync, template update, rebase onto the template, rebase on the template
