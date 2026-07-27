const fs = require('fs');
const path = require('path');

const indexPath = path.resolve('C:/Users/Victus/Desktop/New folder (7)/server/src/index.ts');
let content = fs.readFileSync(indexPath, 'utf-8');

content = content.replace(/app\.post\('\/api\//g, "router.post('/");
content = content.replace(/app\.get\('\/api\//g, "router.get('/");

// Replace end of file with router mounting and JSON 404 fallback
const endSection = `// Start server
app.use('/api', router);
app.use('/', router);

// Fallback JSON 404 handler (ensures HTML is NEVER returned)
app.use((_req, res) => {
  res.status(404).json({ message: 'API endpoint not found. Please check endpoint URL.' });
});

app.listen(PORT, () => {
  console.log(\`🎓 Smart Campus API running on port \${PORT}\`);
});`;

content = content.replace(/\/\/ Start server[\s\S]*/, endSection);

fs.writeFileSync(indexPath, content, 'utf-8');
console.log('Successfully updated index.ts to use Router!');
