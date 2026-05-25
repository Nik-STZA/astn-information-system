# AfricanSTN information system

Internal operating system for African Sports Technology Network (AfricanSTN), operated by Sports Tech Africa Limited.

Confidential. Not for circulation.

---

## What this is

This repository contains the v1 codebase of the AfricanSTN information system. It is a Next.js application deployed to Netlify, sourced from this repository, authenticated through Supabase Auth with Google OAuth, and backed by the existing AfricanSTN Supabase database.

This is the Day 1 deliverable produced on Saturday 24 May 2026. Day 2 (Tuesday) completes the registry browser. Day 3 (Wednesday) adds the profile report builder. v1 ships for the demo on Thursday 28 May 2026.

For the full scoping context, see `AfricanSTN_Information_System_Scoping_Memo_v1.docx` in the STZA project folder.

## What is in this Day 1 bundle

- Next.js 15 project scaffold with TypeScript and Tailwind
- Full STZA brand token system applied (colours, typography, button styles, table styles)
- Login screen with hero protea and the full "African Sports Technology Network" wordmark
- Google OAuth sign-in flow via Supabase Auth
- Allowlist check against an environment variable
- Persistent top navigation bar with AfricanSTN wordmark and protea
- Overview page with live counters, top-country and top-org-type charts, recent intelligence feed
- Registry browser skeleton (Day 2 fleshes this out)
- Reports landing page with sub-navigation (Day 3 adds the profile builder)
- Blocked page for users who authenticate but are not allowlisted
- Sign-out flow
- Security headers configured in `netlify.toml`

## How to deploy this for the first time

### 1. Commit and push

The codebase sits in this directory. To get it into your GitHub repository:

```bash
cd astn-information-system
git init
git add .
git commit -m "Day 1: project foundation, auth, overview page, skeletons"
git branch -M main
git remote add origin https://github.com/Nik-STZA/astn-information-system.git
git push -u origin main
```

If the repository already has commits (for example, if you initialised it with a README on GitHub), run `git pull --rebase origin main` before pushing.

### 2. Connect Netlify to the repository

1. Open https://app.netlify.com/start
2. Click **Import from Git**
3. Choose GitHub, then select the `astn-information-system` repository
4. Branch to deploy: `main`
5. Build command: leave default (Netlify will read `netlify.toml`)
6. Publish directory: leave default (Netlify will read `netlify.toml`)
7. Click **Deploy site**

### 3. Set environment variables

Once Netlify creates the site, open **Site settings** → **Environment variables** and add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vjtdcsshsqnmfcftlver.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase dashboard → Settings → API → anon public) |
| `ALLOWED_EMAILS` | `nik@stza.io` (or whatever email you signed up to Google with) |

After adding all three, trigger a redeploy from **Deploys** → **Trigger deploy** → **Deploy site**.

### 4. Add the Netlify URL to Google OAuth

The OAuth client you created earlier needs to know about the Netlify deployment URL. Open the OAuth client in the Google Cloud Console:

`https://console.cloud.google.com/apis/credentials?project=africanstn-research`

Click the AfricanSTN Information System OAuth client. Under **Authorised redirect URIs**, the Supabase callback should already be there. No change needed here for v1, because the Supabase callback handles all OAuth flow regardless of the deployment URL.

### 5. Sign in for the first time

Once Netlify finishes deploying (1-2 minutes), open your Netlify site URL. You should see the login screen with the hero protea and "African Sports Technology Network" in Brand Gold. Click **Sign in with Google**. Complete the Google flow. You should land on the Overview page with live data from your Supabase database.

If you land on a "This system is private" page instead, the `ALLOWED_EMAILS` environment variable does not match the email you signed in with. Update the variable and trigger a redeploy.

If sign-in fails entirely, check:
- The Supabase Google provider is enabled with the correct Client ID and Secret (Supabase Auth dashboard)
- The Google OAuth client has `https://vjtdcsshsqnmfcftlver.supabase.co/auth/v1/callback` in its authorised redirect URIs

## Project structure

```
astn-information-system/
├── public/
│   └── logos/                          # Brand assets (protea variants, wordmarks)
├── src/
│   ├── app/
│   │   ├── (app)/                      # Authenticated routes (route group)
│   │   │   ├── layout.tsx              # Shared layout with TopNav, auth check
│   │   │   ├── overview/page.tsx       # Home page
│   │   │   ├── registry/page.tsx       # Registry browser (skeleton)
│   │   │   └── reports/page.tsx        # Reports landing (skeleton)
│   │   ├── auth/callback/route.ts      # OAuth callback handler
│   │   ├── blocked/page.tsx            # Not-allowlisted message
│   │   ├── login/page.tsx              # Sign-in screen
│   │   ├── layout.tsx                  # Root layout (fonts, metadata)
│   │   └── page.tsx                    # Root route, redirects to /overview
│   ├── components/                     # Reusable UI components
│   │   ├── CounterCard.tsx
│   │   ├── HorizontalBarChart.tsx
│   │   ├── RecentItemsFeed.tsx
│   │   └── TopNav.tsx
│   ├── lib/
│   │   ├── allowlist.ts                # Allowlist check
│   │   ├── supabase.ts                 # Supabase client setup
│   │   └── data/
│   │       └── overview.ts             # Server-side data fetching
│   ├── styles/
│   │   └── globals.css                 # Brand token application
│   └── middleware.ts                   # Auth enforcement on every request
├── .env.example                        # Template for environment variables
├── .gitignore
├── netlify.toml                        # Netlify build configuration
├── next.config.js
├── package.json
├── postcss.config.js
├── README.md                           # This file
├── tailwind.config.ts                  # Brand tokens, type scale
└── tsconfig.json
```

## Brand application

The codebase follows STZA Brand Guidelines v1.0 throughout:

- Colour tokens defined in `tailwind.config.ts` and `src/styles/globals.css`
- Calibri font family with documented fallback chain
- Sentence case for all UI strings, no em dashes
- Number formatting with comma thousand separators (en-GB locale)
- Date formatting as "24 May 2026" (en-GB, no ordinals)
- "African Sports Technology Network" appears only on the login screen; "AfricanSTN" throughout the rest of the interface
- Protea emblem variants used per memo Section 2.3

## What changes Day 2

Tuesday's deployment will add:

- Functional filter bar on the registry browser (country, sport, org type, confidence)
- Full paginated table with all columns
- Click-through to organisation detail page
- Edit form on the detail page with save-back to Supabase
- Loading states and error handling on the registry flows

The route structure, the brand application, and the auth flow do not change. Day 2 is additive.

## What changes Day 3

Wednesday's deployment will add:

- Profile report builder under Reports
- Brand-correct Word document generation
- Selection by single organisation or filtered subset
- Download flow

## Local development (optional)

If you want to run the application locally for testing:

```bash
npm install
cp .env.example .env.local
# Edit .env.local with the real Supabase keys and your email
npm run dev
```

The application will be available at `http://localhost:3000`.

For Google OAuth to work locally, add `http://localhost:3000/auth/callback` to the authorised redirect URIs on the Google OAuth client. This is optional - signing in via the Netlify deployment also works.

## Support

For anything that does not work, check the conversation transcript with Claude. The build sequence and the memo cover most edge cases. For genuinely new issues, work through with Claude in the next session.

---

Sports Tech Africa Limited - stza.io
African Sports Technology Network - africanstn.com
