# Documenso (sign.andrewmarth.com)

sign.andrewmarth.com runs our own build of Documenso on Cloud Run: service `documenso`, project `my-homes-documenso`,
region us-central1. It is stock Documenso plus one patch:

- `envelope-id-frame.patch`: a rounded frame around each signed signature and initials field, with "Signed by:"
  notched into its top border and, on signatures only, the envelope ID (`envelope_abc…` without the prefix, in
  capitals) notched into its bottom border. Every other field is plain text. The frame is the portal's olive.
- Signed ink is blue (#00208e): signatures and initials keep their usual fonts (a drawn signature is re-inked);
  name, email, date, text and number fields are Arial bold italic. Arial is Liberation Sans (same letter widths),
  installed by the patch's Dockerfile line and registered under the name "Arial". It's drawn into the PDF when Documenso seals it, so the seal stays valid.

## Upgrading Documenso

The patch has to be applied to every new version. Replace `v2.21.1` with the new tag (here and in `cloudbuild.yaml`):

```
git -c core.autocrlf=false clone --depth 1 --branch v2.21.1 https://github.com/documenso/documenso.git dbuild
cd dbuild
git apply ../envelope-id-frame.patch
git ls-files -s | awk '$1=="100755"{print $4}' > .exec-files   # the build restores these files' executable bit
gcloud builds submit --config ../cloudbuild.yaml --project my-homes-documenso --region us-central1 .
gcloud run services update documenso --image us-central1-docker.pkg.dev/my-homes-documenso/documenso/documenso:v2.21.1-frame --project my-homes-documenso --region us-central1
```

Clone with `core.autocrlf=false`: Windows line endings break the image's shell scripts. If the patch no longer
applies, the code it hooks into is `packages/lib/server-only/pdf/insert-field-in-pdf-v2.ts` (the overlay drawn
over each page when a document is sealed).

- It also never adds the signing certificate to the signed PDF (whatever the team's "Include the Signing
  Certificate" setting says; there's no Documenso login to change it). The portal files the signed PDF and the
  certificate (from `/envelope/{id}/certificate/download`) as separate files in Drive.

The portal sends every document with Documenso's emails off (see `api/portal.js`).
