# Third-party notices

The copied code and font below retain their own license terms. The project's
original code is covered by the [MIT License](LICENSE); these third-party materials are covered by the specific terms listed below.

Full copies of the applicable licenses are kept next to the relevant source
and combined in [the browser-accessible notice file](apps/web/public/third-party-notices.txt).
Deployments serve that file at `/third-party-notices.txt`.

## PixelBlast from React Bits

- Copyright (c) 2026 David Haz.
- License: MIT plus Commons Clause, preserved verbatim in
  [PixelBlast.LICENSE.md](apps/web/src/components/PixelBlast.LICENSE.md).
- Verified upstream revision: [`3ca46cae7fe8a89dfd3fed5dc419e94e25fc7aac`](https://github.com/DavidHDev/react-bits/tree/3ca46cae7fe8a89dfd3fed5dc419e94e25fc7aac/src/content/Backgrounds/PixelBlast).
- Covered files: `apps/web/src/components/PixelBlast.jsx` and `PixelBlast.css`.

The JavaScript matches that revision after removing the local `use client`
directive and the added attribution header. The CSS matches after removing the
added header. The license is taken from the same upstream revision.

The published terms permit use as part of an application, website, or product.
They restrict selling, sublicensing, or redistributing the components themselves.
Keep this notice and the full license when distributing the editor. These files
are not relicensed under the editor's MIT license.

## Geist Pixel

- Copyright 2026 The Geist Project Authors.
- License: SIL Open Font License 1.1, preserved verbatim in
  [OFL.txt](apps/web/src/app/fonts/OFL.txt).
- Covered file: `apps/web/src/app/fonts/geist-pixel.ttf`.
- Verified source: [Google Fonts stylesheet](https://fonts.googleapis.com/css2?family=Geist+Pixel) and its
  [versioned font resource](https://fonts.gstatic.com/s/geistpixel/v1/CSRs4zxZluGGW3oyI0A_AN0hQBvYDU4hBmqoKzAMWg.ttf).
- [Pinned Google Fonts license](https://raw.githubusercontent.com/google/fonts/1d1d941341cbcaf2a8d959309d6049facd31134e/ofl/geistpixel/OFL.txt).
- SHA-256: `2ed63dce777ba4093eb48c7f3f0d8f13b1ab38d6b450bba80f848903926447a6`.

The bundled font is byte-for-byte identical to that Google Fonts resource.
Its embedded copyright matches the accompanying Google Fonts OFL notice.
Embedding and redistribution are permitted under OFL 1.1 with those notices;
the font retains its own license.

## Package dependencies

Installed npm dependencies retain their own LICENSE and NOTICE files. This
index covers the copied source and bundled font above, not every transitive npm
dependency. In particular, Mediabunny is MPL-2.0 licensed: preserve its notices
and provide access to the corresponding covered source when distributing
browser bundles. Its file-level requirements do not relicense the editor's own
code. Sharp is Apache-2.0 licensed, and its bundled libvips binaries include
LGPL-3.0-or-later terms; retain their notices and applicable redistribution
materials when shipping binaries or containers.

Third-party gameplay imagery in screenshots and browser logos are not covered
by the editor's MIT license. Their copyright and trademark rights remain with
their respective owners.
