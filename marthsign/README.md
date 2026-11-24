# MarthSign (sign.andrewmarth.com)

MarthSign is the portal's e-signature service: our own build of the open-source Documenso app (AGPL-3.0), renamed
and restyled, on Cloud Run (service `documenso`, project `my-homes-documenso`, region us-central1; Google Cloud
doesn't rename those). Signers only ever see it inside the portal's signing page (`sign.html`).

What `marthsign.patch` changes:

- **Name:** `marthsign-rebrand.sh` (added by the patch, run by Cloud Build) writes MarthSign wherever the app writes
  its name: screens, page titles, the disclosure, the PDFs' signing reason and certificate, translations. The logos,
  icons and certificate logo are MarthSign's (the icons are the portal's).
- **Colors:** the portal's palette (`packages/ui/styles/theme.css`, `packages/tailwind-config`), always light.
- **Signing screen** (`/embed/sign/...`, what the portal shows full-screen): the portal's header (logo, Back,
  Sign Out) and hero at the top, then the document, all one page scroll (`components/embed/marthsign-hero.tsx`;
  Back and Sign Out are messages to the portal). A download button in place of the Actions menu.
- **Signatures:** always the default, the signer's name typed; no draw-or-type pop-up. The portal asks for consent
  (the same e-signature consent text) before the signing screen can be used.
- **Signed PDFs:** a rounded frame around each signed signature and initials field, with "Signed by:" notched into
  its top border and, on signatures only, the envelope ID (`envelope_abc…` without the prefix, in capitals) notched
  into its bottom border. Every other field is plain text. The frame is the portal's olive. Signed ink is blue
  (#00208e): signatures and initials keep their usual fonts; name, email, date, text and number fields are Arial bold
  italic. Arial is Liberation Sans (same letter widths), installed by the patch's Dockerfile line and registered as
  "Arial". It's drawn into the PDF when the document is sealed, so the seal stays valid.
- It never adds the signing certificate to the signed PDF (there's no login to change the team's "Include the
  Signing Certificate" setting). The portal files the signed PDF and the certificate (from
  `/envelope/{id}/certificate/download`) as separate files in Drive.

The portal sends every document with the app's emails off (see `api/portal.js`).

## Upgrading

The patch has to be applied to every new version. Replace `v2.21.1` with the new tag (here and in `cloudbuild.yaml`):

```
git -c core.autocrlf=false clone --depth 1 --branch v2.21.1 https://github.com/documenso/documenso.git build
cd build
git config core.autocrlf false   # so the patch's new files keep their line endings too
git apply ../marthsign.patch
git ls-files -s | awk '$1=="100755"{print $4}' > .exec-files   # the build restores these files' executable bit
gcloud builds submit --config ../cloudbuild.yaml --project my-homes-documenso --region us-central1 .
gcloud run services update documenso --image us-central1-docker.pkg.dev/my-homes-documenso/marthsign/marthsign:v2.21.1 --project my-homes-documenso --region us-central1
```

Keep `core.autocrlf` off (clone and apply): Windows line endings break the image's shell scripts. If the patch no longer
applies, the files it changes are listed at the top of each section of `marthsign.patch`; the sealing overlay is
`packages/lib/server-only/pdf/insert-field-in-pdf-v2.ts`.
