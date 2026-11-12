import * as pako from 'pako';

/**
 * Generates synthetic realistic JSON datasets for instant in-browser testing
 */

export function generateSyntheticDataset(recordCount: number = 50000): any[] {
  const records = [];
  const statuses = ['delivered', 'processing', 'shipped', 'cancelled', 'refunded'];
  const categories = ['Electronics', 'Home & Kitchen', 'Books', 'Clothing', 'Automotive', 'Health'];
  const paymentMethods = ['credit_card', 'apple_pay', 'google_pay', 'crypto', 'paypal'];

  for (let i = 1; i <= recordCount; i++) {
    records.push({
      order_id: `ORD-2026-${String(i).padStart(7, '0')}`,
      sequence: i,
      customer: {
        id: `CUST-${1000 + (i % 8000)}`,
        name: `Customer ${i % 500}`,
        email: `user_${i % 500}@example.com`,
        tier: i % 10 === 0 ? 'VIP' : i % 3 === 0 ? 'Gold' : 'Standard',
      },
      transaction: {
        amount: +(Math.sin(i) * 50 + 75).toFixed(2),
        currency: 'USD',
        status: statuses[i % statuses.length],
        payment_method: paymentMethods[i % paymentMethods.length],
        created_at: new Date(1773000000000 + i * 60000).toISOString(),
      },
      items: [
        {
          sku: `SKU-${100 + (i % 250)}`,
          category: categories[i % categories.length],
          quantity: (i % 4) + 1,
          unit_price: +((i % 40) + 9.99).toFixed(2),
        },
      ],
      tags: ['ecommerce', categories[i % categories.length].toLowerCase().replace(/\s+/g, '-')],
    });
  }

  return records;
}

/**
 * Creates a .json.gz blob for testing GZIP upload and decompression
 */
export function createGzipDatasetBlob(records: any[]): { blob: Blob; fileName: string } {
  const jsonString = JSON.stringify(records);
  const compressed = pako.gzip(jsonString);
  const blob = new Blob([compressed], { type: 'application/gzip' });
  return {
    blob,
    fileName: `dataset_${records.length}_records.json.gz`,
  };
}

/**
 * Creates a corrupted JSON blob for testing error recovery
 */
export function createCorruptedJsonBlob(): { blob: Blob; fileName: string } {
  const brokenContent = `[
  {"id": 1, "status": "ok", "value": 100},
  {"id": 2, "status": "corrupt", "payload": { "unclosed_string": "oops...
`;
  const blob = new Blob([brokenContent], { type: 'application/json' });
  return {
    blob,
    fileName: 'corrupted_dataset.json',
  };
}
