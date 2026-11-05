const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(document = {}) {
  const context = vm.createContext({ window: {}, document, Event: class {constructor(type) {this.type = type;}}, Map });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/schedule/sector-exams.js'), 'utf8'), context);
  return context;
}

test('CRM exposes one exam link and no separate composition or booking controls',()=>{
  const root={hidden:true,className:'',innerHTML:''};const context=load({getElementById:()=>root});
  context.renderSectorExamBanner();
  assert.match(root.innerHTML,/https:\/\/app.maestro.com.kz\/admin\/sector-exams/);
  assert.equal(typeof context.openSectorExamModal,'undefined');
  assert.equal(typeof context.submitSectorExamSchedule,'undefined');
  assert.equal(typeof context.toggleSectorExamSession,'undefined');
});
