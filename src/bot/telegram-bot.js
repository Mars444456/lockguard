const https=require('node:https');
const {RuleEngine}=require('../core');
const MAX_SQL_BYTES=512*1024;
const SITE='https://mars444456.github.io/lockguard/';
const ACCOUNT='https://lockguard-test-cabinet.onrender.com/';
const keyboard={keyboard:[[{text:'Проверить SQL'},{text:'Пример SQL'}],[{text:'Кабинет и Pro'},{text:'Поддержать проект'}]],resize_keyboard:true};

function request(url,{method='GET',payload,maxBytes=1024*1024}={}){
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method,timeout:30000,headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(new Error('Response too large'));}else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{if(res.statusCode!==200)return reject(new Error('Telegram request failed'));resolve(Buffer.concat(chunks));});
    });
    req.on('error',()=>reject(new Error('Telegram connection failed')));
    req.on('timeout',()=>{req.destroy();reject(new Error('Telegram request timed out'));});
    req.end(payload);
  });
}
const plain=html=>html.replace(/<[^>]*>/g,'').replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&');
function chunks(text){const result=[];let part='';for(const char of text){if(part.length+char.length>3900){result.push(part);part='';}part+=char;}if(part)result.push(part);return result;}

function createBot({token=process.env.TELEGRAM_BOT_TOKEN,transport,download,formatAuditMessage}={}){
  if(!transport&&!/^\d+:[\w-]+$/.test(token||''))throw new Error('Set TELEGRAM_BOT_TOKEN in the environment or .env file.');
  const api=transport||async function(method,data){
    const body=await request(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',payload:JSON.stringify(data)});
    const response=JSON.parse(body.toString('utf8'));if(!response.ok)throw new Error('Telegram API rejected the request');return response.result;
  };
  const getFile=download||async function(path){
    if(typeof path!=='string'||! /^[\w/.-]+$/.test(path)||path.split('/').includes('..'))throw new Error('Invalid Telegram file path');
    return request(`https://api.telegram.org/file/bot${token}/${path}`,{maxBytes:MAX_SQL_BYTES});
  };
  const engine=new RuleEngine();
  const send=async(chatId,text,options={})=>{for(const part of chunks(text))await api('sendMessage',{chat_id:chatId,text:part,disable_web_page_preview:true,reply_markup:options.reply_markup||keyboard});};
  const account=chatId=>send(chatId,'Доступ Pro и срок подписки определяются вашим аккаунтом на сервере. Бот не подтверждает оплату и не выдаёт лицензии. Донат не активирует подписку.',{reply_markup:{inline_keyboard:[[{text:'Открыть кабинет',url:ACCOUNT}],[{text:'Тарифы и контакты',url:SITE+'contacts.html'}]]}});
  async function audit(chatId,sql,filename){
    if(typeof sql!=='string'||!sql.trim()||Buffer.byteLength(sql)>MAX_SQL_BYTES)throw new Error('Invalid SQL input');
    await RuleEngine.initialize();const result=engine.analyze(sql,{filename});
    await send(chatId,plain(formatAuditMessage(result,sql)));
  }
  async function handleUpdate(update){
    const callback=update.callback_query,msg=callback?.message||update.message;
    if(!msg?.chat||msg.chat.type!=='private')return;
    const id=msg.chat.id,text=(callback?.data||msg.text||'').trim();
    if(callback){await api('answerCallbackQuery',{callback_query_id:callback.id}).catch(()=>{});}
    try{
      if(['claim_pro_key','/pro','Кабинет и Pro'].includes(text)||/Получить ключ|Проверить оплату|Тариф Pro/.test(text))return account(id);
      if(['/donate','donate','Поддержать проект'].includes(text)||/Донат/.test(text))return send(id,'Добровольная поддержка разработки. Донат не является оплатой Pro.',{reply_markup:{inline_keyboard:[[{text:'Поддержать разработку',url:'https://www.donationalerts.com/r/marswwu'}]]}});
      if(['/start','/help','Проверить SQL'].includes(text))return send(id,'LockGuard проверяет SQL-миграции PostgreSQL по статическим правилам. Отправьте SQL текстом или файлом .sql/.txt до 512 КБ. SQL не исполняется, нагрузка и длительность блокировок не измеряются. Не присылайте пароли или данные клиентов. Анализ происходит на сервере бота; исходный SQL не записывается в журнал.\nВеб-версия с локальным анализом: '+SITE);
      if(['test_sql_sample','Пример SQL','📖 Тестовый опасный SQL'].includes(text))return audit(id,'CREATE INDEX idx_orders_customer ON orders(customer_id);','example.sql');
      if(msg.document){
        const doc=msg.document;
        if(!/\.(sql|txt)$/i.test(doc.file_name||'')||!Number.isSafeInteger(doc.file_size)||doc.file_size>MAX_SQL_BYTES||doc.file_size<1)return send(id,'Прикрепите .sql или .txt размером от 1 байта до 512 КБ.');
        const info=await api('getFile',{file_id:doc.file_id});
        const bytes=Buffer.from(await getFile(info.file_path));if(bytes.length>MAX_SQL_BYTES)throw new Error('File too large');
        return await audit(id,new TextDecoder('utf-8',{fatal:true}).decode(bytes),'attachment.sql');
      }
      if(text&&!text.startsWith('/'))return await audit(id,text,'message.sql');
      return send(id,'Отправьте SQL текстом, файлом .sql/.txt или используйте /help.');
    }catch{
      await send(id,'Проверка не завершена: не удалось прочитать файл или разобрать SQL. Проверьте синтаксис PostgreSQL, кодировку UTF-8 и размер до 512 КБ. Подробный разбор доступен в веб-версии: '+SITE);
    }
  }
  async function startPolling({signal}={}){
    await RuleEngine.initialize();let offset=0;
    while(!signal?.aborted){
      try{const updates=await api('getUpdates',{offset,timeout:20,allowed_updates:['message','callback_query']});
        if(!Array.isArray(updates))throw new Error('Invalid updates');
        for(const update of updates){if(signal?.aborted)break;await handleUpdate(update);offset=update.update_id+1;}
      }catch{if(!signal?.aborted){console.error('Telegram update failed; retrying. Message content and credentials are not logged.');await new Promise(resolve=>setTimeout(resolve,5000));}}
    }
  }
  return {handleUpdate,startPolling};
}
module.exports={createBot,MAX_SQL_BYTES,chunks};
