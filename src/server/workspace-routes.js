module.exports = function workspaceRoutes(router,db,auth) {
  const current = req => {
    if(!req.auth)throw Object.assign(new Error('Войдите в аккаунт.'),{statusCode:401});
    return req.auth;
  };
  router.get('/api/v1/workspaces',async(req,res)=>res.json({workspaces:db.workspaces.list(current(req))}));
  router.get('/api/v1/operations',async(req,res)=>{db.workspaces.owner(current(req));return res.json({operations:require('./operational-status')(db)});});
  router.post('/api/v1/workspaces/select',async(req,res)=>{
    db.workspaces.select(current(req),auth.token(req),req.body.organizationId);
    return res.json(auth.response(auth.authenticate(req)));
  });
  router.get('/api/v1/team',async(req,res)=>{const user=current(req);return res.json({members:db.workspaces.members(user),invites:user.role==='owner'?db.workspaces.invitations(user):[]});});
  router.delete('/api/v1/team/invites/:id',async(req,res)=>res.json({success:db.workspaces.revokeInvitation(current(req),req.params.id)}));
  router.post('/api/v1/team/invites',async(req,res)=>res.status(201).json({invite:db.workspaces.invite(current(req),req.body)}));
  router.post('/api/v1/team/accept',async(req,res)=>{
    const user=current(req),id=db.workspaces.accept(user,req.body.token);
    db.workspaces.select(user,auth.token(req),id);return res.json(auth.response(auth.authenticate(req)));
  });
  router.delete('/api/v1/team/:id',async(req,res)=>{db.workspaces.remove(current(req),req.params.id);return res.json({success:true});});
  router.get('/api/v1/reviews',async(req,res)=>res.json({reviews:db.workspaces.listReviews(current(req))}));
  router.post('/api/v1/reviews',async(req,res)=>res.status(201).json({review:db.workspaces.createReview(current(req),req.body)}));
  router.get('/api/v1/reviews/:id',async(req,res)=>res.json({review:db.workspaces.getReview(current(req),req.params.id)}));
  router.post('/api/v1/reviews/:id/events',async(req,res)=>res.json({review:db.workspaces.event(current(req),req.params.id,req.body)}));
  router.delete('/api/v1/reviews/:id',async(req,res)=>{db.workspaces.deleteReview(current(req),req.params.id);return res.json({success:true});});
};
