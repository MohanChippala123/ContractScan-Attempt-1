# ContractScan AI on Vercel

This app is ready to deploy on Vercel as-is.

## Files Vercel uses

- `index.html` is the frontend.
- `api/analyze.js` is the serverless API route at `/api/analyze`.
- `package.json` tells Vercel this is a Node project.
- `vercel.json` keeps the deployment config explicit.

## Deploy

1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. Deploy.

The app works without a Groq API key by using the built-in local rule-based scanner.

## Optional AI mode

To enable Groq-powered analysis later, add this Environment Variable in Vercel:

```text
GROQ_API_KEY=your_groq_key
```

Then redeploy. If the key is missing, the app automatically falls back to local scanning.
