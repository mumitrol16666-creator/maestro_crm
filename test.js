const { JSDOM } = require("jsdom");
const dom = new JSDOM(`<!DOCTYPE html><select id="test"></select>`);
const select = dom.window.document.getElementById('test');
const selectedOption = select.options[select.selectedIndex];
console.log("selectedOption:", selectedOption);
console.log("dataset test:", selectedOption?.dataset?.pricingTrial);
let price = parseInt(selectedOption?.dataset?.pricingTrial) || 2000;
console.log("price:", price);
