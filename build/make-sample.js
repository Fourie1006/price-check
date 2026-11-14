'use strict';
const path = require('path');
const { writeTemplate } = require('../src/excel');
const items = [
  { name: 'Nivea Men Anti-Age face anti age cream', brand: 'Nivea', variant: '', size: '', quantity: 3, alternatives: 'No', notes: '', search: 'nivea men anti-age', must: 'men,anti,age' },
  { name: 'Listerine cool mint', brand: 'Listerine', variant: '', size: '750ml min', quantity: 6, alternatives: 'No', notes: '', search: 'listerine cool mint 750ml', must: 'cool,mint' },
  { name: 'Jungle Oats The Original Favourite', brand: 'Jungle Oats', variant: 'The Original Favourite', size: '1 or 2kg', quantity: '12kg', alternatives: 'No', notes: '12kg total, whichever pack size works out best', search: 'jungle oats', must: 'jungle,oat' },
  { name: 'Mitchum Advanced Gel', brand: 'Mitchum', variant: 'any variant', size: '', quantity: 6, alternatives: 'No', notes: '', search: 'mitchum advanced gel', must: 'gel' },
  { name: 'Nivea men black and white anti perspirant', brand: 'Nivea', variant: 'Invisible Fresh Deodorant Spray', size: '', quantity: 5, alternatives: 'No', notes: '', search: 'nivea men black white invisible fresh spray', must: 'black,white,invisible,fresh,spray' },
  { name: 'Domestos Unstoppable Extended Power Plain (750 ml)', brand: 'Domestos', variant: '', size: '', quantity: 5, alternatives: 'No', notes: '', search: 'domestos unstoppable extended power 750ml', must: 'unstoppable' },
  { name: 'Handy Andy Cream Lavender Clean Boost (750 ml)', brand: 'Handy Andy', variant: '', size: '', quantity: 5, alternatives: 'No', notes: '', search: 'handy andy cream lavender 750ml', must: 'lavender,cream' },
  { name: 'Duck Deep Action Toilet Cleaner', brand: 'Duck', variant: 'Any variant', size: '', quantity: 6, alternatives: 'Yes', notes: 'Any variant; alternatives also acceptable', search: 'duck deep action toilet', must: 'deep,action' },
  { name: "Ingram's Herbal Camphor Cream 450gr min", brand: "Ingram's", variant: '', size: '450g min', quantity: 2, alternatives: 'No', notes: '', search: 'ingrams camphor cream', must: 'camphor,cream' },
  { name: 'Toilet rim', brand: '', variant: 'Any reputable brand', size: '', quantity: 6, alternatives: 'Yes', notes: '', search: 'toilet rim block', must: 'rim' },
];
writeTemplate(path.join(__dirname, '..', 'sample', 'shopping_list_sample.xlsx'), items).then(() => console.log('sample written'));
