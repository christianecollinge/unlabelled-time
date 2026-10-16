# Deployment

Unlabelled Time runs as its own Cloud Run service, `unlabelled-time`, in the project `unlabelled-cloud-lab`, region `europe-west1`, with its own Postgres database at Neon, behind the shared Keycloak. None of this exists yet; these are the steps, following emee's (`docs/deployment.md` in the emee repository).

## 1. Keycloak (realm `unlabelled`)

1. A client with ID `time`: client authentication **off** (public), **standard flow** only, **Require PKCE** with **S256**.
   - Root URL `https://time.unlabelled.cc`
   - Valid redirect URIs `https://time.unlabelled.cc/auth/callback`
   - Valid post logout redirect URIs `https://time.unlabelled.cc/auth/signed-out`
   - Web origins empty.
2. A role named `time` (realm role, or a role of the `time` client), given to each account that may use the app.
3. The sign-in theme in emee's `keycloak-theme/unlabelled` names its title after the client and links the three tools; it should learn about Time too.

## 2. Neon

A project in Frankfurt (`aws-eu-central-1`) with a database `time`. Copy the **pooled** connection string. The app creates its own tables on first use.

## 3. Secrets and the service account

| Secret | Content |
| --- | --- |
| `time-session-secret` | `openssl rand -base64 48` |
| `time-database-url` | The pooled Neon connection string |

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create time-session-secret --project unlabelled-cloud-lab --replication-policy user-managed --locations europe-west1 --data-file=-
```

```bash
pbpaste | tr -d '\n' | gcloud secrets create time-database-url --project unlabelled-cloud-lab --replication-policy user-managed --locations europe-west1 --data-file=-
```

```bash
gcloud iam service-accounts create time-run --project unlabelled-cloud-lab --display-name "Unlabelled Time Cloud Run service"
```

Then give `time-run@unlabelled-cloud-lab.iam.gserviceaccount.com` `roles/secretmanager.secretAccessor` on each of the two secrets, and nothing else.

## 4. The service

From a clean export of the commit:

```bash
gcloud run deploy unlabelled-time --source . --project unlabelled-cloud-lab --region europe-west1 --allow-unauthenticated --memory 512Mi --set-env-vars "KEYCLOAK_ISSUER=https://login.unlabelled.cc/realms/unlabelled,KEYCLOAK_CLIENT_ID=time,KEYCLOAK_REQUIRED_ROLE=time,APP_ORIGIN=https://time.unlabelled.cc" --set-secrets "SESSION_SECRET=time-session-secret:latest,DATABASE_URL=time-database-url:latest" --service-account time-run@unlabelled-cloud-lab.iam.gserviceaccount.com
```

Later deploys leave the settings flags out, so the service keeps them.

## 5. The address

A Cloud Run domain mapping, as emee and the sign-in have (`unlabelled.cc` is already verified with Google):

```bash
gcloud beta run domain-mappings create --service unlabelled-time --domain time.unlabelled.cc --region europe-west1 --project unlabelled-cloud-lab
```

Then a **DNS-only** CNAME `time` → `ghs.googlehosted.com` in Cloudflare. Check with `gcloud beta run domain-mappings describe --domain time.unlabelled.cc --region europe-west1 --project unlabelled-cloud-lab`, `/api/health`, `/api/ready`, and a real sign-in.

## 6. Before real use

The privacy policy on unlabelled.cc needs a part for Unlabelled Time: what it stores (projects, time entries and notes, name and email from the sign-in), where (Neon, Frankfurt; Google Cloud, Belgium), and that it uses a session cookie.
