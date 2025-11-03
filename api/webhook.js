// api/webhook.js
const Stripe = require('stripe');
const getRawBody = require('raw-body');

/**
 * Vercel Node serverless function
 * Expects Stripe to POST events here.
 * Remember to set the env vars:
 *   STRIPE_SECRET_KEY       = sk_test_...
 *   STRIPE_WEBHOOK_SECRET   = whsec_...
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let rawBody;
  try {
    rawBody = await getRawBody(req); // must be raw, not parsed JSON
  } catch (err) {
    res.statusCode = 400;
    return res.end(`Unable to read raw body: ${err.message}`);
  }

  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    res.statusCode = 400;
    return res.end(`Webhook Error: ${err.message}`);
  }

  // 👇 Handle the events you care about
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', session.id);
        // TODO: mark user as paid / grant access
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        console.log('✅ invoice.paid', invoice.id);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('✅ invoice.payment_succeeded', invoice.id);
        break;
      }
      default:
        console.log('ℹ️ Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('Handler error:', err);
    res.statusCode = 500;
    return res.end('Handler failed');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ received: true }));
};
