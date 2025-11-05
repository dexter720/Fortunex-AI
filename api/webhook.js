const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-10-29.clover'
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('✅ Checkout completed', event.data.object.id);
        break;
      case 'invoice.payment_succeeded':
        console.log('✅ Invoice paid', event.data.object.id);
        break;
      case 'invoice.payment_failed':
        console.log('❌ Invoice failed', event.data.object.id);
        break;
      default:
        console.log(`ℹ️ Unhandled event: ${event.type}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).send('Server error');
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
