const { Client } = require('@neondatabase/serverless');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const daysAgo = (d, m = 0) => new Date(Date.now() - d * 86400000 + m * 60000).toISOString();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }
  const client = new Client({
    connectionString,
  });

  await client.connect();
  console.log('Connected. Starting seed...');

  // 1. Clear existing data (disable trigger, truncate, re-enable)
  await client.query("DROP TRIGGER IF EXISTS campaign_event_immutable ON \"CampaignEvent\"");
  await client.query("TRUNCATE TABLE \"ProcessingFailure\",\"AIToolExecution\",\"AIMessage\",\"AIConversation\",\"WebhookReceipt\",\"CampaignEvent\",\"CampaignLog\",\"CampaignAnalytics\",\"Campaign\",\"Segment\",\"Order\",\"Customer\",\"User\" CASCADE");
  await client.query("CREATE TRIGGER campaign_event_immutable BEFORE UPDATE OR DELETE ON \"CampaignEvent\" FOR EACH ROW EXECUTE FUNCTION prevent_campaign_event_mutation()");
  console.log('Cleared all tables.');

  // 2. Admin user
  const userId = uuid();
  await client.query(
    'INSERT INTO "User" (id, name, email, "passwordHash", role, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $6)',
    [userId, 'Xeno Evaluator', 'admin@xeno.local', 'hashed_placeholder', 'ADMIN', now()]
  );
  console.log('Created admin user.');

  // 3. 1000 customers
  const cities = ['Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Pune','Kolkata','Ahmedabad'];
  const firstNames = ['Aarav','Aditi','Arjun','Diya','Ishaan','Kavya','Mira','Neel','Priya','Rohan','Sara','Vihaan'];
  const lastNames = ['Sharma','Patel','Mehta','Iyer','Kapoor','Reddy','Gupta','Nair'];
  const categories = ['coffee','fashion','beauty','electronics'];

  const cIds = [];
  let vals = [];
  for (let i = 0; i < 1000; i++) {
    const id = uuid();
    cIds.push(id);
    const first = firstNames[i % 12];
    const last = lastNames[Math.floor(i / 12) % 8];
    const meta = JSON.stringify({ city: cities[i % 8], emailEngagement: (i * 17) % 101, preferredCategory: categories[i % 4] });
    vals.push(`('${id}','${first} ${last} ${i + 1}','shopper${String(i + 1).padStart(4, '0')}@example.com','+91${7000000000 + i}','${meta}','${daysAgo(180 - (i % 180))}')`);
    if (vals.length === 100) {
      await client.query('INSERT INTO "Customer" (id,name,email,phone,metadata,"createdAt") VALUES ' + vals.join(','));
      vals = [];
    }
  }
  if (vals.length) await client.query('INSERT INTO "Customer" (id,name,email,phone,metadata,"createdAt") VALUES ' + vals.join(','));
  console.log('Created 1000 customers.');

  // 4. 5000 orders
  const oIds = [];
  vals = [];
  for (let i = 0; i < 5000; i++) {
    const id = uuid();
    oIds.push(id);
    const amt = (20 + ((i * 37) % 480) + (i % 100) / 100).toFixed(2);
    const items = JSON.stringify([{ sku: 'SKU-' + String((i % 120) + 1).padStart(3, '0'), quantity: (i % 3) + 1 }]);
    vals.push(`('${id}','${cIds[i % 1000]}',${amt},'${items}','${daysAgo(i % 120, i % 1440)}')`);
    if (vals.length === 200) {
      await client.query('INSERT INTO "Order" (id,"customerId",amount,items,"createdAt") VALUES ' + vals.join(','));
      vals = [];
    }
  }
  if (vals.length) await client.query('INSERT INTO "Order" (id,"customerId",amount,items,"createdAt") VALUES ' + vals.join(','));
  console.log('Created 5000 orders.');

  // 5. 20 segments
  const segTpls = [
    { name: 'Inactive VIP Shoppers', rules: { operator: 'AND', conditions: [{ field: 'totalSpent', operator: '>', value: 500 }, { field: 'daysSinceLastOrder', operator: '>', value: 30 }] } },
    { name: 'Summer Sale Audience', rules: { operator: 'AND', conditions: [{ field: 'orderCount', operator: '>', value: 0 }, { field: 'emailEngagement', operator: '<', value: 45 }] } },
    { name: 'High LTV Loyalists', rules: { operator: 'AND', conditions: [{ field: 'totalSpent', operator: '>', value: 1000 }, { field: 'orderCount', operator: '>', value: 5 }] } },
    { name: 'Recent Buyers', rules: { operator: 'AND', conditions: [{ field: 'daysSinceLastOrder', operator: '<=', value: 14 }] } },
    { name: 'Win-Back Targets', rules: { operator: 'AND', conditions: [{ field: 'daysSinceLastOrder', operator: '>', value: 60 }, { field: 'totalSpent', operator: '>', value: 200 }] } }
  ];

  const sIds = [];
  vals = [];
  for (let i = 0; i < 20; i++) {
    const id = uuid();
    sIds.push(id);
    const tpl = segTpls[i % 5];
    const name = i < 5 ? tpl.name : tpl.name + ' ' + (i + 1);
    vals.push(`('${id}','${name}','Deterministic evaluator seed segment','${JSON.stringify(tpl.rules)}','${daysAgo(30 - i)}','${daysAgo(30 - i)}')`);
  }
  await client.query('INSERT INTO "Segment" (id,name,description,rules,"createdAt","updatedAt") VALUES ' + vals.join(','));
  console.log('Created 20 segments.');

  // 6. 10 campaigns
  const campNames = ['Summer Sale','VIP Early Access','Cart Recovery','Monsoon Essentials','Loyalty Thank You','New Arrival Drop','Weekend Flash Deal','Beauty Replenishment','Coffee Lovers Club','Festive Preview'];
  const chs = ['EMAIL','WHATSAPP','SMS','RCS'];
  const campIds = [];
  vals = [];
  for (let i = 0; i < 10; i++) {
    const id = uuid();
    campIds.push(id);
    const nm = campNames[i];
    vals.push(`('${id}','${nm}','${sIds[i % 20]}','${chs[i % 4]}','COMPLETED','${nm}: selected for you','Hi {{first_name}}, explore our ${nm.toLowerCase()} collection today.',1000,'${daysAgo(10 - i, 30)}','${daysAgo(10 - i, 180)}','${daysAgo(11 - i)}','${daysAgo(11 - i)}')`);
  }
  await client.query('INSERT INTO "Campaign" (id,name,"segmentId",channel,status,subject,message,"audienceSizeSnapshot","launchedAt","completedAt","createdAt","updatedAt") VALUES ' + vals.join(','));
  console.log('Created 10 campaigns.');

  // 7. CampaignEvents (50000) + CampaignLogs (10000)
  const del = [600, 989, 989, 989, 989, 989, 989, 989, 989, 988];
  const opn = [120, 876, 876, 876, 876, 876, 876, 876, 876, 872];
  const clk = [15, 777, 776, 776, 776, 776, 776, 776, 776, 776];
  const conv = [2, 554, 553, 553, 553, 553, 553, 553, 553, 553];
  const fail = [400, 12, 11, 11, 11, 11, 11, 11, 11, 11];

  let totalE = 0, totalL = 0, attrIdx = 0;

  for (let ci = 0; ci < 10; ci++) {
    const cId = campIds[ci];
    const base = new Date(daysAgo(10 - ci, 30));
    const corr = uuid();
    let eBatch = [], lBatch = [], em = 0;

    // Helper: format event row with all 10 columns (id, eventId, type, campaignId, customerId, correlationId, payload, occurredAt, createdAt, attributedOrderId)
    const evt = (eid, type, cid2, custid, pl, oa, aoid2 = null) =>
      `('${uuid()}','${eid}','${type}','${cid2}',${custid ? "'" + custid + "'" : 'null'},'${corr}','${pl}','${oa}','${now()}',${aoid2 ? "'" + aoid2 + "'" : 'null'})`;

    eBatch.push(evt(uuid(), 'CampaignCreated', cId, null, '{"seeded":true}', new Date(base.getTime() - 3600000).toISOString()));
    eBatch.push(evt(uuid(), 'CampaignLaunched', cId, null, '{"audienceSize":1000}', base.toISOString()));

    for (let cu = 0; cu < 1000; cu++) {
      const cst = cIds[cu];
      const qa = new Date(base.getTime() + em++ * 10);
      const sa = new Date(qa.getTime() + 30000);

      eBatch.push(evt(uuid(), 'MessageQueued', cId, cst, `{"channel":"${chs[ci % 4]}"}`, qa.toISOString()));
      eBatch.push(evt(uuid(), 'MessageSent', cId, cst, `{"channel":"${chs[ci % 4]}"}`, sa.toISOString()));

      let st = 'SENT', le = sa, aoid = null;

      if (cu < del[ci]) {
        le = new Date(sa.getTime() + 60000);
        eBatch.push(evt(uuid(), 'MessageDelivered', cId, cst, '{"provider":"xeno-simulator"}', le.toISOString()));
        st = 'DELIVERED';
      }
      if (cu < opn[ci]) {
        le = new Date(sa.getTime() + 120000);
        eBatch.push(evt(uuid(), 'MessageOpened', cId, cst, '{"device":"mobile"}', le.toISOString()));
        st = 'OPENED';
      }
      if (cu < clk[ci]) {
        le = new Date(sa.getTime() + 180000);
        eBatch.push(evt(uuid(), 'MessageClicked', cId, cst, '{"destination":"/offer"}', le.toISOString()));
        st = 'CLICKED';
      }
      if (cu < conv[ci]) {
        le = new Date(sa.getTime() + 240000);
        aoid = oIds[attrIdx % 5000];
        attrIdx++;
        eBatch.push(evt(uuid(), 'MessageConverted', cId, cst, '{"attributionWindow":"7d"}', le.toISOString(), aoid));
        st = 'CONVERTED';
      }
      if (cu >= del[ci] && cu < del[ci] + fail[ci]) {
        le = new Date(sa.getTime() + 75000);
        const reason = ci === 0 ? 'Suppressed or invalid destination' : 'Simulated provider rejection';
        eBatch.push(evt(uuid(), 'MessageFailed', cId, cst, `{"reason":"${reason}"}`, le.toISOString()));
        st = 'FAILED';
      }

      const fr = st === 'FAILED' ? (ci === 0 ? 'Suppressed or invalid destination' : 'Simulated provider rejection') : null;
      lBatch.push(`('${uuid()}','${cId}','${cst}','${st}','${le.toISOString()}',${aoid ? "'" + aoid + "'" : 'null'},${fr ? "'" + fr + "'" : 'null'},'${now()}','${now()}')`);

      if (eBatch.length >= 500) {
        await client.query('INSERT INTO "CampaignEvent" (id,"eventId",type,"campaignId","customerId","correlationId",payload,"occurredAt","createdAt","attributedOrderId") VALUES ' + eBatch.join(','));
        totalE += eBatch.length;
        eBatch = [];
      }
      if (lBatch.length >= 500) {
        await client.query('INSERT INTO "CampaignLog" (id,"campaignId","customerId",status,"lastEventAt","attributedOrderId","failureReason","createdAt","updatedAt") VALUES ' + lBatch.join(','));
        totalL += lBatch.length;
        lBatch = [];
      }
    }

    if (eBatch.length) {
      await client.query('INSERT INTO "CampaignEvent" (id,"eventId",type,"campaignId","customerId","correlationId",payload,"occurredAt","createdAt","attributedOrderId") VALUES ' + eBatch.join(','));
      totalE += eBatch.length;
    }
    if (lBatch.length) {
      await client.query('INSERT INTO "CampaignLog" (id,"campaignId","customerId",status,"lastEventAt","attributedOrderId","failureReason","createdAt","updatedAt") VALUES ' + lBatch.join(','));
      totalL += lBatch.length;
    }
    console.log(`  Campaign ${ci + 1}/10 done (events: ${totalE}, logs: ${totalL})`);
  }
  console.log(`Total events: ${totalE} | Total logs: ${totalL}`);

  // 8. CampaignAnalytics
  vals = [];
  for (let i = 0; i < 10; i++) {
    vals.push(`('${uuid()}','${campIds[i]}',1000,1000,1000,${del[i]},${opn[i]},${clk[i]},${conv[i]},${fail[i]},${((del[i] / 1000) * 100).toFixed(2)},${((opn[i] / del[i]) * 100).toFixed(2)},${((clk[i] / opn[i]) * 100).toFixed(2)},${clk[i] === 0 ? 0 : ((conv[i] / clk[i]) * 100).toFixed(2)},0.00,'${now()}')`);
  }
  await client.query('INSERT INTO "CampaignAnalytics" (id,"campaignId","totalAudience","totalQueued","totalSent","totalDelivered","totalOpened","totalClicked","totalConverted","totalFailed","deliveryRate","openRate","clickRate","conversionRate","revenueAccrued","updatedAt") VALUES ' + vals.join(','));
  console.log('Created 10 analytics rows.');

  // 9. WebhookReceipts (100 most recent) - use parameterized queries to avoid timezone issues
  const wr = await client.query(`SELECT "eventId","campaignId","customerId",type,"correlationId",payload,"occurredAt" FROM "CampaignEvent" WHERE type IN ('MessageDelivered','MessageOpened','MessageClicked','MessageConverted','MessageFailed') ORDER BY "occurredAt" DESC LIMIT 100`);
  console.log(`Found ${wr.rows.length} webhook receipt candidates.`);
  if (wr.rows.length) {
    // Insert in batches of 10 using parameterized queries
    for (let b = 0; b < wr.rows.length; b += 10) {
      const batch = wr.rows.slice(b, b + 10);
      for (const r of batch) {
        await client.query(
          'INSERT INTO "WebhookReceipt" (id,"eventId","campaignId","customerId",type,"correlationId",payload,"receivedAt","processedAt",attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,1)',
          [uuid(), r.eventId, r.campaignId, r.customerId, r.type, r.correlationId, JSON.stringify(r.payload), r.occurredAt]
        );
      }
    }
  }
  console.log(`Created ${wr.rows.length} webhook receipts.`);

  // 10. AI Conversation
  const cid = uuid();
  await client.query('INSERT INTO "AIConversation" (id,title,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)', [cid, 'Why did Summer Sale fail?', now()]);
  await client.query('INSERT INTO "AIMessage" (id,"conversationId",role,content,"createdAt") VALUES ($1,$2,$3,$4,$5)', [uuid(), cid, 'USER', 'Why did Summer Sale fail?', now()]);
  await client.query('INSERT INTO "AIMessage" (id,"conversationId",role,content,grounding,"createdAt") VALUES ($1,$2,$3,$4,$5,$6)', [
    uuid(), cid, 'ASSISTANT',
    'Summer Sale underperformed because delivery reached only 60%, then just 20% of delivered recipients opened the message. The recorded failure ledger shows 400 suppressed or invalid destinations. The largest opportunities are destination hygiene and audience/message fit.',
    JSON.stringify({ tool: 'diagnoseCampaignFailure', sources: ['Campaign:' + campIds[0], 'CampaignAnalytics', 'CampaignEvent', 'CampaignLog'] }),
    now()
  ]);
  console.log('Created AI conversation.');

  await client.end();
  console.log('\n✅ Seed completed successfully!');
  console.log(`   Customers: 1000`);
  console.log(`   Orders: 5000`);
  console.log(`   Segments: 20`);
  console.log(`   Campaigns: 10`);
  console.log(`   Campaign Events: ${totalE}`);
  console.log(`   Campaign Logs: ${totalL}`);
  console.log(`   Webhook Receipts: ${wr.rows.length}`);
  console.log(`   AI Conversations: 1`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
