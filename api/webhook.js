// /api/webhook.js

// Make sure Vercel gives us the raw body and runs on Node.js
export const config = {
  api: { bodyParser: false },
  runtime: "nodejs",
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // Health check for GET (so it won't crash when you open the URL)
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Hard guard against missing env vars
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    res.status(500).send("Server misconfigured");
    return;
  }

  // Import Stripe in a way that always works on Vercel
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-10-29.clover",
  });

  const signature = req.headers["stripe-signature"];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        console.log("Checkout completed:", event.data.object.id);
        break;
      case "invoice.payment_succeeded":
        console.log("Payment succeeded:", event.data.object.id);
        break;
      case "invoice.payment_failed":
        console.log("Payment failed:", event.data.object.id);
        break;
      default:
        console.log("Unhandled event:", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).send("Internal error");
  }
}
