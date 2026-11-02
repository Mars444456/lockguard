const crypto = require('node:crypto');
const {requirePro} = require('./pro-features');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message,statusCode=400) => {throw Object.assign(new Error(message),{statusCode});};
const clean = (value,max,label) => {if(typeof value!=='string'||!value.trim()||value.length>max)fail(label);return value.trim();};
const checks = ['schemaFresh','backfillVerified','applicationCompatible','stagingVerified'];

class WorkspaceService {
  constructor(db) {
    this.db=db;this.sql=db.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),organization_id TEXT NOT NULL REFERENCES organizations(id),role TEXT NOT NULL CHECK(role IN ('owner','editor','reviewer')),PRIMARY KEY(user_id,organization_id));
      CREATE TABLE IF NOT EXISTS session_workspaces(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,organization_id TEXT NOT NULL REFERENCES organizations(id));
      CREATE TABLE IF NOT EXISTS workspace_invites(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),email TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS migration_reviews(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE INDEX IF NOT EXISTS reviews_org ON migration_reviews(organization_id);
      INSERT OR IGNORE INTO memberships(user_id,organization_id,role) SELECT id,organization_id,'owner' FROM users;
    `);
  }
  addOwner(user) {this.sql.prepare("INSERT INTO memberships(user_id,organization_id,role) VALUES(?,?,'owner')").run(user.id,user.organizationId);}
  member(user) {const member=this.sql.prepare('SELECT role FROM memberships WHERE user_id=? AND organization_id=?').get(user.id,user.organizationId);if(!member)fail('Доступ к организации отозван.',403);return member;}
  owner(user) {if(this.member(user).role!=='owner')fail('Требуется роль владельца организации.',403);}
  list(user) {return this.sql.prepare('SELECT m.organization_id AS id,m.role,o.data FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=?').all(user.id).map(r=>({id:r.id,role:r.role,name:JSON.parse(r.data).name}));}
  select(user,token,id) {
    if(typeof id!=='string'||id.length>100)fail('Неверный идентификатор организации.');
    if(!this.sql.prepare('SELECT 1 FROM memberships WHERE user_id=? AND organization_id=?').get(user.id,id))fail('Организация не найдена.',404);
    if(id!==this.sql.prepare('SELECT organization_id FROM users WHERE id=?').get(user.id)?.organization_id)this.db.emailVerification.requireVerified(user.id);
    this.sql.prepare('INSERT INTO session_workspaces(token_hash,organization_id) VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET organization_id=excluded.organization_id').run(digest(token),id);
  }
  members(user) {this.member(user);return this.sql.prepare('SELECT u.id,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.created_at').all(user.organizationId);}
  invitations(user) {this.owner(user);return this.sql.prepare('SELECT id,email,role,expires_at AS expiresAt FROM workspace_invites WHERE organization_id=? AND expires_at>?').all(user.organizationId,Date.now());}
  revokeInvitation(user,id) {this.owner(user);return !!this.sql.prepare('DELETE FROM workspace_invites WHERE id=? AND organization_id=?').run(id,user.organizationId).changes;}
  invite(user,body) {
    this.owner(user);requirePro(this.db.forOrganization(user.organizationId));
    this.db.emailVerification.requireVerified(user.id);
    const email=clean(body.email,254,'Укажите email участника.').toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['editor','reviewer'].includes(body.role))fail('Неверный email или роль.');
    return this.db.transaction(()=>{
      this.sql.prepare('DELETE FROM workspace_invites WHERE expires_at<=?').run(Date.now());
      if(this.members(user).length>=20||this.sql.prepare('SELECT count(*) AS n FROM workspace_invites WHERE organization_id=?').get(user.organizationId).n>=20)fail('Лимит — 20 участников и 20 приглашений.',409);
      const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+48*3600000,id='invite_'+crypto.randomUUID();
      this.sql.prepare('DELETE FROM workspace_invites WHERE organization_id=? AND email=?').run(user.organizationId,email);
      this.sql.prepare('INSERT INTO workspace_invites VALUES(?,?,?,?,?,?,?)').run(id,user.organizationId,email,body.role,digest(token),expiresAt,user.id);
      return {id,token,email,role:body.role,expiresAt:new Date(expiresAt).toISOString()};
    });
  }
  accept(user,token) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Приглашение недействительно.',404);
    return this.db.transaction(()=>{
      const invite=this.sql.prepare('SELECT * FROM workspace_invites WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now());
      if(!invite||invite.email!==user.email.toLowerCase())fail('Приглашение недействительно для этого аккаунта.',404);
      this.db.emailVerification.requireVerified(user.id);
      requirePro(this.db.forOrganization(invite.organization_id));
      if(this.sql.prepare('SELECT count(*) AS n FROM memberships WHERE organization_id=?').get(invite.organization_id).n>=20)fail('Лимит участников достигнут.',409);
      this.sql.prepare('INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(user_id,organization_id) DO NOTHING').run(user.id,invite.organization_id,invite.role);
      this.sql.prepare('DELETE FROM workspace_invites WHERE id=?').run(invite.id);
      return invite.organization_id;
    });
  }
  remove(user,id) {
    this.owner(user);
    const member=this.sql.prepare('SELECT role FROM memberships WHERE user_id=? AND organization_id=?').get(id,user.organizationId);
    if(!member)fail('Участник не найден.',404);
    if(member.role==='owner')fail('Владельца нельзя удалить.',409);
    this.db.transaction(()=>{
      this.sql.prepare('DELETE FROM session_workspaces WHERE organization_id=? AND token_hash IN (SELECT token_hash FROM sessions WHERE user_id=?)').run(user.organizationId,id);
      this.sql.prepare('DELETE FROM memberships WHERE user_id=? AND organization_id=?').run(id,user.organizationId);
      this.sql.prepare('DELETE FROM workspace_invites WHERE organization_id=? AND email=(SELECT email FROM users WHERE id=?)').run(user.organizationId,id);
    });
  }
  listReviews(user) {this.member(user);return this.sql.prepare("SELECT id,json_extract(data,'$.title') AS title,json_extract(data,'$.status') AS status,json_extract(data,'$.revision') AS revision,json_extract(data,'$.assigneeId') AS assigneeId,json_extract(data,'$.createdAt') AS createdAt,json_extract(data,'$.updatedAt') AS updatedAt FROM migration_reviews WHERE organization_id=? ORDER BY rowid DESC").all(user.organizationId);}
  getReview(user,id) {
    this.member(user);
    const row=this.sql.prepare('SELECT data FROM migration_reviews WHERE id=? AND organization_id=?').get(id,user.organizationId);
    if(!row)fail('Ревью не найдено.',404);const review=JSON.parse(row.data);
    return {...review,approvalCurrent:review.status==='approved'&&review.waivers.every(w=>Date.parse(w.expiresAt)>Date.now())};
  }
  createReview(user,body) {
    user={...user,role:this.member(user).role};
    requirePro(this.db.forOrganization(user.organizationId));if(user.role==='reviewer')fail('Рецензент не создаёт изменения.',403);
    if(typeof body.runId!=='string'||body.runId.length>100)fail('Неверный идентификатор проверки.');
    const title=clean(body.title,120,'Название: от 1 до 120 символов.'),run=this.db.forOrganization(user.organizationId).getRun(body.runId);
    if(!run)fail('Проверка не найдена.',404);
    if(run.findingsVersion!==1||run.analysisComplete===false||run.coverageComplete!==true)fail('Для ревью нужна полная проверка нового формата без отключённых или подавленных правил.',409);
    let sql=null;
    if(body.sql!==undefined) {
      if(typeof body.sql!=='string'||Buffer.byteLength(body.sql)>256*1024||digest(body.sql)!==run.sqlHash)fail('SQL отличается от выбранной проверки или превышает 256 КБ.');
      sql=body.sql;
    }
    return this.db.transaction(()=>{
      if(this.member(user).role==='reviewer')fail('Рецензент не создаёт изменения.',403);
      if(this.listReviews(user).length>=100)fail('Лимит — 100 карточек ревью.',409);
      const now=new Date().toISOString();
      const review={id:'review_'+crypto.randomUUID(),organizationId:user.organizationId,title,status:'draft',revision:1,authorId:user.id,assigneeId:null,
        createdAt:now,updatedAt:now,sql,run,checks:Object.fromEntries(checks.map(key=>[key,false])),waivers:[],
        events:[{kind:'created',actorId:user.id,at:now,revision:1}]};
      this.sql.prepare('INSERT INTO migration_reviews VALUES(?,?,?)').run(review.id,user.organizationId,JSON.stringify(review));return review;
    });
  }
  event(user,id,body) {
    requirePro(this.db.forOrganization(user.organizationId));
    return this.db.transaction(()=>{
      user={...user,role:this.member(user).role};
      const review=this.getReview(user,id);
      if(body.expectedRevision!==review.revision)fail('Ревью изменилось. Обновите карточку.',409);
      if(review.events.length>=500)fail('Достигнут лимит событий карточки.',409);
      const event={kind:body.kind,actorId:user.id,at:new Date().toISOString(),revision:review.revision+1};
      switch(body.kind) {
        case 'comment':event.text=clean(body.text,4000,'Комментарий: от 1 до 4000 символов.');break;
        case 'assign':
          if(user.role==='reviewer')fail('Недостаточно прав.',403);
          if(body.assigneeId!==null&&!this.members(user).some(m=>m.id===body.assigneeId))fail('Ответственный не найден.');
          review.assigneeId=event.assigneeId=body.assigneeId;review.status='draft';break;
        case 'attest':
          if(user.role==='reviewer')fail('Подтверждения заполняет автор или редактор.',403);
          if(!checks.includes(body.check)||typeof body.value!=='boolean')fail('Неизвестное подтверждение.');
          review.checks[body.check]=event.value=body.value;event.check=body.check;review.status='draft';break;
        case 'waive': {
          this.owner(user);
          if(!Number.isInteger(body.findingIndex)||!review.run.findings?.[body.findingIndex])fail('Замечание не найдено.');
          const expires=Date.parse(body.expiresAt);
          if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+90*86400000)fail('Исключение действует не более 90 дней.');
          const waiver={findingIndex:body.findingIndex,reason:clean(body.text,2000,'Укажите причину исключения.'),actorId:user.id,expiresAt:new Date(expires).toISOString()};
          review.waivers=review.waivers.filter(w=>w.findingIndex!==waiver.findingIndex).concat(waiver);event.waiver=waiver;review.status='draft';break;
        }
        case 'submit':
          if(user.role==='reviewer')fail('Недостаточно прав.',403);
          review.status='in_review';break;
        case 'request_changes':
          event.text=clean(body.text,4000,'Опишите необходимые изменения.');review.status='changes_requested';break;
        case 'approve':
          if(user.id===review.authorId)fail('Нужен независимый участник: автор не согласует собственное изменение.',403);
          if(review.status!=='in_review'||!checks.every(key=>review.checks[key]))fail('Отправьте на ревью и подтвердите все проверки.',409);
          if(review.run.findings.some((f,index)=>['CRITICAL','HIGH'].includes(f.severity)&&!review.waivers.some(w=>w.findingIndex===index&&Date.parse(w.expiresAt)>Date.now())))fail('Устраните высокие риски или оформите временное исключение с причиной.',409);
          event.text=clean(body.text,2000,'Укажите основание согласования.');review.status='approved';break;
        default:fail('Неизвестное действие.');
      }
      review.revision++;review.updatedAt=event.at;review.events.push(event);
      delete review.approvalCurrent;
      if(Buffer.byteLength(JSON.stringify(review))>1024*1024)fail('Карточка достигла лимита 1 МБ. Экспортируйте её и создайте новую.',409);
      this.sql.prepare('UPDATE migration_reviews SET data=? WHERE id=? AND organization_id=?').run(JSON.stringify(review),id,user.organizationId);
      return this.getReview(user,id);
    });
  }
  deleteReview(user,id) {this.owner(user);this.getReview(user,id);this.sql.prepare('DELETE FROM migration_reviews WHERE id=? AND organization_id=?').run(id,user.organizationId);}
}
module.exports={WorkspaceService,digest,checks};
