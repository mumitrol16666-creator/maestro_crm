const mongoose = require('mongoose');
const Student = require('./src/models/Student');

mongoose.connect('mongodb+srv://senseofdance:Sens3ofDanc3@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority')
.then(async () => {
  const teachers = await Student.find({ role: 'teacher', status: 'active' })
    .select('name lastName teacherInfo.photo teacherInfo.displayOrder')
    .sort({ 'teacherInfo.displayOrder': 1 });
    
  console.log('\n=== УЧИТЕЛЯ И ИХ ФОТО ===\n');
  teachers.forEach((t, i) => {
    const photo = t.teacherInfo?.photo || 'НЕТ ФОТО';
    console.log(`${i+1}. ${t.name} ${t.lastName || ''}`);
    console.log(`   Фото: ${photo}`);
    console.log(`   Порядок: ${t.teacherInfo?.displayOrder || 0}\n`);
  });
  
  process.exit(0);
})
.catch(err => { 
  console.error('Ошибка:', err.message); 
  process.exit(1); 
});

