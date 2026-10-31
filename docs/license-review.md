# License review

Reviewed on 2026-10-31 against the current workspace manifests, lockfile,
selected installed license files, copied source, bundled assets, and upstream
license documents. This is a release-preparation review, not a legal opinion
or a complete audit of every transitive dependency's source.

The UI now uses Tabler icons exclusively. Unused icon packages and the icon
library switching system were removed during cleanup. Other dependencies and
copied assets were not removed or relicensed as part of this review.

## Release assessment

Most declared dependencies use standard open-source licenses. The three copied
asset notice issues are resolved: PixelBlast's source revision and license are
verified, and the full Geist Pixel and Lina notices are included. All three can
remain in this application under their respective terms.

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for source revisions,
verification details, and links to the full licenses. A combined notice file is
also served at `/third-party-notices.txt` for deployed builds.

PixelBlast retains its MIT plus Commons Clause restrictions. It is included as
part of the editor, and must not be presented as a separately MIT-licensed
component library. No asset was relicensed or replaced to resolve these items.

## Remaining project decisions

### Repository license: not selected

There is no root LICENSE file. In addition,
`packages/typescript-config/package.json` still declares `PROPRIETARY`, despite
being a private workspace package with public publish configuration. Reconcile
that declaration with the intended project license after choosing one. No
license metadata was changed during this review.

## Dependencies and assets with standard licenses

| Component | Evidence | Assessment and remaining work |
| --- | --- | --- |
| Next.js, React, date-fns, next-themes, Sonner, Three.js, Base UI, Framer Motion, Tabler, and most tooling | Locked package metadata; selected installed license files checked | Standard MIT terms. Preserve applicable notices when redistributing source or bundled code. |
| TypeScript, PDF.js, class-variance-authority | Locked Apache-2.0 metadata | Standard open-source terms. Preserve license and applicable notices in distributions. |
| Postprocessing | Installed `postprocessing/LICENSE.md` | Zlib license. Preserve its notice and mark altered source versions if distributing changes. |
| Mediabunny 1.62.1 | Installed manifest and LICENSE | MPL-2.0. Compatible with use in a larger application under other terms, subject to file-level source and notice obligations. |
| Lightning CSS | Locked MPL-2.0 metadata | Same file-level license considerations; primarily used by the build toolchain. |
| Sharp / libvips | Locked package metadata and upstream documentation | Sharp uses Apache-2.0; bundled libvips packages include LGPL-3.0-or-later. Keep their notices and meet the applicable terms when distributing native binaries or containers. |
| Geist Pixel | Bundled font name table and upstream OFL | Standard OFL-1.1 terms. Matching full license and copyright notice now included alongside the font and in the deployed notice file. |
| Lina adaptations | Source comments and upstream MIT license | Permitted under MIT. Full upstream notice now included in both adapted source headers, the UI package notice, and the deployed notice file. |

[MPL's official FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains the
file-level obligations and combining MPL code with other licenses. Dependency
use does not automatically require licensing the entire editor under MPL.
For browser bundles, provide access to the corresponding covered source and
license notices. No local modifications to Mediabunny's package source were
identified in this review.

[Sharp's licensing documentation](https://sharp.pixelplumbing.com/#licensing)
describes Sharp and its native dependencies. Declaring an npm dependency in a
source repository is different from redistributing its compiled native binaries.
The LGPL entries are not, by themselves, a reason to remove Sharp or Next.js.

The bundled Geist Pixel font was matched byte for byte to a versioned Google
Fonts resource. The corresponding Google Fonts OFL contains the same 2026
copyright as the font. PixelBlast's JavaScript and CSS were matched to upstream
revision `3ca46cae7fe8a89dfd3fed5dc419e94e25fc7aac`, allowing only the local
client directive and new attribution headers. Its license was copied from that
same revision. The Lina MIT notice is pinned to a recorded upstream revision
and preserved in full. See the third-party notice index for the source links.

## Other bundled images

The landing screenshots contain third-party gameplay imagery and visible media
filenames. Browser logos are also included. Their presence does not establish
permission to relicense those images under the project's future code license.
Confirm their sources and permitted use, or use project-owned demonstration
footage for release screenshots. No images were removed for licensing reasons.

## Remaining release work

1. Choose a license for the project's own code and reconcile workspace metadata.
2. Confirm rights for screenshots and other bundled imagery.
3. Preserve dependency notices and corresponding covered source when preparing
   distributable browser bundles, binaries, or containers.

This document records findings and next steps. It is not a replacement for
LICENSE files or a completed third-party notice bundle.
