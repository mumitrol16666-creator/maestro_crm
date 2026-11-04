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

test('CRM groups participant exams by their prepared session without merging legacy exams', () => {
  const context = load();
  const rows = context.groupSectorExamQueue([
    {examId:'e1',sessionId:'session-1',sessionTitle:'Гитара, ноябрь'},
    {examId:'e2',sessionId:'session-1',sessionTitle:'Гитара, ноябрь'},
    {examId:'e3',sessionId:'session-2',sessionTitle:'Гитара, ноябрь'},
    {examId:'e4',title:'Сектор 1'}, {examId:'e5',title:'Сектор 1'},
  ]);
  assert.equal(rows.length,4);
  assert.equal(rows[0].exams.length,2);
  assert.equal(rows[1].exams.length,1);
  assert.equal(rows[2].key,'individual:e4');
  assert.equal(rows[3].key,'individual:e5');
});

test('selecting a session toggles only its participants and keeps another session untouched', () => {
  let changes = 0;
  const inputs = [{dataset:{session:'s1'},checked:false},{dataset:{session:'s1'},checked:true},{dataset:{session:'s2'},checked:true}];
  const context = load({querySelectorAll:()=>inputs,getElementById:()=>({dispatchEvent:()=>changes++})});
  context.toggleSectorExamSession('s1');
  assert.deepEqual(inputs.map(input=>input.checked),[true,true,true]);
  context.toggleSectorExamSession('s1');
  assert.deepEqual(inputs.map(input=>input.checked),[false,false,true]);
  assert.equal(changes,2);
});
