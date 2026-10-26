// node ui/build.js  ->  ui/janus.html (one self-contained file: the server serves it, the preview publishes it)
const fs = require('fs'), path = require('path'), S = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');
const js = ['fonts.js', 'core.js', 'backend.js', 'app.js'].map(S).join('\n');
if (js.includes('</script')) throw new Error('</script in js');
const html = S('shell.html').replace('/*CSS*/', () => S('shell.css')).replace('/*JS*/', () => js);
fs.writeFileSync(path.join(__dirname, 'janus.html'), html); console.log('ui/janus.html', (html.length / 1024).toFixed(1) + ' KB');
