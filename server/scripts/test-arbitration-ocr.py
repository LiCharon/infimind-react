"""Render a fictional Chinese scan and exercise the existing local OCR (no LLM).

python server/scripts/test-arbitration-ocr.py
Uses installed Pillow and Node dependencies; writes only a dedicated temp folder.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
output = Path(tempfile.mkdtemp(prefix='fafee-arbitration-ocr-'))
lines = [
    '劳动仲裁申请书（完全虚构测试）',
    '申请人：虚构林某；被申请人：虚构星河公司',
    '仲裁请求：',
    '1、支付工作日延时加班费12000元。',
    '2、支付未休年休假工资6000元。',
    '事实与理由：2025年1月1日入职。',
    '2025年12月31日离职，月工资8000元。',
    '劳动合同履行地：杭州市。',
    '本材料不是客户资料，只用于文字识别测试。',
]
image = Image.new('RGB', (2100, 2970), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 55)
for i, line in enumerate(lines):
    draw.text((100, 140 + i * 160), line, fill='black', font=font)
image.save(output / 'fictional-chinese-scan.png')
image.save(output / 'fictional-chinese-scan.pdf', 'PDF', resolution=200)
parser_uri = (root / 'server/services/file-parser.js').as_uri()
runner = f"""
import assert from 'node:assert/strict';
import {{ readFile, writeFile }} from 'node:fs/promises';
import {{ extractText }} from {json.dumps(parser_uri)};
const outcomes = [];
for (const [name, mime] of [['fictional-chinese-scan.png','image/png'],['fictional-chinese-scan.pdf','application/pdf']]) {{
  const start = Date.now();
  try {{
    const parsed = await extractText({{originalname:name,mimetype:mime,buffer:await readFile(name)}},{{signal:AbortSignal.timeout(180000)}});
    await writeFile(name+'.result.json',JSON.stringify(parsed,null,2));
    for (const expected of ['12000','6000','8000','仲裁','加班']) assert.ok(parsed.text.includes(expected),name+' missing '+expected);
    outcomes.push({{name,ok:true,ms:Date.now()-start,characters:parsed.text.length,metadata:parsed.metadata}});
    console.log('PASS actual Chinese OCR:',name);
  }} catch (error) {{
    outcomes.push({{name,ok:false,ms:Date.now()-start,error:error.message}});
    console.error('FAIL actual Chinese OCR:',name,error.message);
  }}
}}
const controller = new AbortController();
const timer = setTimeout(()=>controller.abort(new Error('synthetic-user-stop')),150);
const start = Date.now();
try {{
  await extractText({{originalname:'cancel-scan.png',mimetype:'image/png',buffer:await readFile('fictional-chinese-scan.png')}},{{signal:controller.signal}});
  outcomes.push({{name:'real-ocr-cancel',ok:false,error:'取消后仍返回成功'}});
}} catch (error) {{
  outcomes.push({{name:'real-ocr-cancel',ok:controller.signal.aborted && Date.now()-start<5000,ms:Date.now()-start,error:error.message}});
}} finally {{clearTimeout(timer)}}
await writeFile('summary.json',JSON.stringify({{outcomes}},null,2));
if(outcomes.some(item=>!item.ok)) process.exitCode=1;
"""
(output / 'run.mjs').write_text(runner, encoding='utf-8')
print(f'OCR_TEST_OUTPUT {output}', flush=True)
# Tesseract's language cache stays in this temp cwd, not the repository.
result = subprocess.run(['node', '--use-env-proxy', str(output / 'run.mjs')], cwd=output, timeout=420)
raise SystemExit(result.returncode)
