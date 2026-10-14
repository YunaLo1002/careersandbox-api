// One-off migration: move flat experience fields into the current schema.
// Old shape: { period, role, action, result, learning }
// New shape: { timeRange, description: { role, action, result, learning } }
// Only touches documents that still have the old `period` field.
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.collection('experiences');

  const before = await col.countDocuments({ period: { $exists: true } });
  console.log(`Documents to migrate: ${before}`);

  const result = await col.updateMany(
    { period: { $exists: true } },
    [
      {
        $set: {
          timeRange: { $ifNull: ['$period', ''] },
          description: {
            role: { $ifNull: ['$role', ''] },
            action: { $ifNull: ['$action', ''] },
            result: { $ifNull: ['$result', ''] },
            learning: { $ifNull: ['$learning', ''] },
          },
        },
      },
      { $unset: ['period', 'role', 'action', 'result', 'learning'] },
    ]
  );

  console.log(`Modified: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });