import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      console.log('✅ Checkout session completed:', event.data.object.id);
      break;
    case 'invoice.payment_succeeded':
      console.log('💰 Payment succeeded:', event.data.object.id);
      break;
    case 'customer.subscription.deleted':
      console.log('🧾 Subscription canceled:', event.data.object.id);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
