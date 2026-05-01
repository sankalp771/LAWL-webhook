const { Client } = require('pg'); 
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_VfUJgtQoL1I5@ep-solitary-sound-aopt1j4z-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' }); 

client.connect().then(async () => { 
  const res = await client.query(`
    SELECT d.id, d.subscriber_id, s.url, s.secret, e.payload, d.attempt_count 
    FROM deliveries d 
    JOIN events e ON e.id = d.event_id 
    JOIN subscribers s ON s.id = d.subscriber_id 
    WHERE d.status IN ('pending', 'failed') AND d.next_retry_at <= now() 
      AND NOT EXISTS ( 
        SELECT 1 
        FROM deliveries d2 
        WHERE d2.subscriber_id = d.subscriber_id 
          AND d2.sequence_id = d.sequence_id 
          AND d2.sequence_id IS NOT NULL 
          AND d2.status IN ('pending', 'processing', 'failed') 
          AND d2.created_at < d.created_at 
      ) 
    LIMIT 10
  `); 
  console.log('ROWS:', res.rows); 
  client.end(); 
}).catch(console.error);
