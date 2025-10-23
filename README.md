# Fortunex AI (PWA) – Intelligent Educational Crypto Analysis

Fortunex AI is a mobile-first PWA that gives simple, educational insights from DEX links. Free users get 2 analyses/day; Pro unlocks unlimited and advanced metrics.

## Quick start
```bash
npm i
npm run dev
```
Open http://localhost:5173

## Stripe setup
- Create two Payment Links in Stripe (Pro, Elite)
- Set Success URL to: http://localhost:5173/?pro=1 (or your deployed URL with ?pro=1)
- Paste links into `src/App.jsx`:
```js
export const STRIPE_PRO_LINK   = "https://buy.stripe.com/test_XXXXXXXXXXXXpro";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_XXXXXXXXXXXXelite";
```

## Deploy
- Push to GitHub → Deploy on Vercel (Vite auto-detected)
- Update Stripe Success URL to your live domain: https://YOUR-APP/?pro=1
- On mobile, use “Add to Home Screen” to install as an app.
