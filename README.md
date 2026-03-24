# dormio

Fitbit sleep calendar app.

A static web app that visualizes Fitbit sleep phases on a monthly calendar. Built with SvelteKit and deployed via GitHub Pages.

## Setup

1. Register a personal app at [dev.fitbit.com](https://dev.fitbit.com)
   - OAuth 2.0 Application Type: Personal
   - Callback URL: `https://<username>.github.io/dormio/callback/`
   - Scopes: `Sleep`

2. Open the app, click **Setup**, and enter your Fitbit Client ID.

3. Click **Connect Fitbit** to authorize.

## Development

```sh
npm install
npm run dev
```

## Deploy

Push to `main` — GitHub Actions builds and deploys to GitHub Pages automatically.
