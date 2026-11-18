/* Infiniti Transportes | BI Comercial - módulos operacionais adicionais.
   Somente leitura. Não modifica DATA, EXTRA, KPIs nem filtros existentes.
   Regras: emissão = CT-e distinto; viagem = CT-e ou cadeia comprovada de troca de nota.
*/
(function () {
  'use strict';
  const host = typeof window !== 'undefined' ? window : globalThis;
  const money = v => (Number(v) || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const fmt = (v, decimals=0) => (Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const safe = value => { if (typeof value === 'number') return Number.isFinite(value) ? value : 0; let s = String(value ?? '').replace(/R\$/g,'').trim(); if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); const n=Number(s);return Number.isFinite(n)?n:0; };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const digits = v => String(v ?? '').replace(/\D/g,'');
  const isValid = s => s !== '' && s !== 'NÃO INFORMADO' && s !== 'NAO INFORMADO';
  const DATE = v => {const s=String(v??'');let a=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);if(a)return new Date(+a[1],+a[2]-1,+a[3],+(a[4]||0),+(a[5]||0));a=s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2}))?/);if(a)return new Date(a[3].length===2?2000+ +a[3]:+a[3],+a[2]-1,+a[1],+(a[4]||0),+(a[5]||0));return null;};
  const iso = d => d && Number.isFinite(+d) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
  const sorted = x => x.slice().sort((a,b)=>b.count-a.count || String(a.label).localeCompare(String(b.label),'pt-BR'));
  const keyCTe = r => [clean(r.nm_agencia),String(r.nr_ctrc??'').replace(/\.0$/,''),digits(r.nr_cnpj_cpf_pagador)||clean(r.nm_pessoa_pagador),iso(DATE(r.dt_emissao)),clean(r.ds_placa)].join('|');

  function emissions(rows, granularity='mes') {
    const seen=new Set(),people=new Map(),periods=new Map();
    for(const r of rows){
      const code=String(r.nr_ctrc??'').trim(); if(!code)continue;
      const key=keyCTe(r);if(seen.has(key))continue;seen.add(key);
      const name=clean(r.nm_pessoa_usuario)||'NÃO INFORMADO';
      const person=people.get(name)||{label:String(r.nm_pessoa_usuario||'Não informado').trim(),count:0};person.count++;people.set(name,person);
      const d=DATE(r.dt_emissao);if(!d)continue;
      let period;
      if(granularity==='dia')period=iso(d);
      else if(granularity==='semana'){const monday=new Date(d);monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));period=iso(monday);}
      else if(granularity==='trimestre')period=`${d.getFullYear()}-T${Math.floor(d.getMonth()/3)+1}`;
      else if(granularity==='ano')period=String(d.getFullYear());
      else period=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      periods.set(period,(periods.get(period)||0)+1);
    }
    return {total:seen.size, people:sorted([...people.values()]),periods:[...periods].sort(([a],[b])=>a.localeCompare(b)).map(([label,count])=>({label,count}))};
  }

  const legalWords=new Set(['LTDA','S','A','SA','EIRELI','ME','EPP','INDUSTRIA','COMERCIO','COMERCIAL','DE','DA','DO','DAS','DOS','E','SOCIEDADE','UNIDADE','FILIAL','MATRIZ','COM','IND','CIA']);
  function payerWords(name){return clean(name).split(' ').filter(w=>w.length>2 && !legalWords.has(w) && !/^\d+$/.test(w));}
  function samePayer(a,b){
    const ca=digits(a.cnpj),cb=digits(b.cnpj);
    if(ca.length===14 && cb.length===14 && ca.slice(0,8)===cb.slice(0,8))return true;
    if(ca.length===11 && cb.length===11 && ca===cb)return true;
    const na=clean(a.payer),nb=clean(b.payer);
    if(na && na===nb)return true;
    const wa=[...new Set(payerWords(a.payer))],wb=[...new Set(payerWords(b.payer))];
    if(wa.length<2||wb.length<2||wa[0]!==wb[0])return false;
    const shared=wa.filter(w=>wb.includes(w)).length;
    return shared/Math.max(wa.length,wb.length)>=0.74;
  }
  const esPorts=new Set(['SERRA','VILA VELHA','VITORIA','CARIACICA']);
  function sameTransferPoint(a,b){
    if(!a.destUF || !b.origUF || a.destUF!==b.origUF)return false;
    if(a.destCity && b.origCity && a.destCity===b.origCity)return true;
    return a.destUF==='ES' && esPorts.has(a.destCity) && esPorts.has(b.origCity);
  }
  function normalizeProduct(v){
    const s=clean(v);if(!s)return 'NÃO INFORMADO';
    const rules=[[/FERTILIZ|ADUBO/,'FERTILIZANTE'],[/MOVEI|MOVEL|MOBILIA/,'MÓVEIS'],[/DORMENTE/,'DORMENTE DE CONCRETO'],[/DEFENSIV|AGROTOX/,'DEFENSIVO AGRÍCOLA'],[/LARANJA|CITRICO/,'LARANJA'],[/SOJA/,'SOJA'],[/MILHO/,'MILHO'],[/ACUCAR/,'AÇÚCAR'],[/ADOCANTE/,'ADOÇANTE'],[/CAFE/,'CAFÉ'],[/TRIGO/,'TRIGO'],[/OLEO/,'ÓLEO'],[/BEBIDA/,'BEBIDAS'],[/CIMENTO/,'CIMENTO'],[/CARNE/,'CARNE'],[/PAPEL|CELULOSE/,'PAPEL E CELULOSE']];
    for(const [exp,cat] of rules)if(exp.test(s))return cat;
    const part=s.split(/\s+OUTROS\s+|\s+\-\s+|\s{2,}/)[0];return part.slice(0,65);
  }
  function mergeSameDocument(rows){
    const grouped=new Map();
    for(const r of rows){
      const key=keyCTe(r);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);
    }
    return [...grouped.values()].map(list=>{
      const r=list[0],d=DATE(r.dt_emissao),freightDriver=Math.max(...list.map(x=>Math.max(0,safe(x.vl_frete_motorista))));
      // O relatório detalhado pode repetir um mesmo CT-e em mais de uma linha de NF.
      const nfValue=Math.max(...list.map(x=>Math.max(0,safe(x.vl_nota_fiscal))));
      const dominant=list.slice().sort((a,b)=>safe(b.vl_nota_fiscal)-safe(a.vl_nota_fiscal))[0];
      return {
        code:String(r.nr_ctrc??'').replace(/\.0$/,''),date:d,day:iso(d),plate:clean(r.ds_placa).replace(/\s/g,''),
        cnpj:r.nr_cnpj_cpf_pagador,payer:r.nm_pessoa_pagador,
        origCity:clean(r.nm_cidade_origem),origUF:clean(r.ds_uf_origem),
        destCity:clean(r.nm_cidade_destino),destUF:clean(r.ds_uf_destino),
        driver:String(r.nm_pessoa_motorista||'').trim(),cpf:digits(r.nr_cpf_motorista),
        value:nfValue,weight:Math.max(...list.map(x=>Math.max(0,safe(x.vl_peso)))),driverFreight:freightDriver,
        product:normalizeProduct(dominant.nm_produto), agency:String(r.nm_agencia||''), rows:list
      };
    });
  }
  function newTrip(leg){return {legs:[leg],first:leg,last:leg,joined:false};}
  // Regra validada para viagens físicas: uma placa por dia de emissão representa
  // uma viagem consolidada, independentemente do número de CT-es e notas fiscais.
  // Sem placa/data confiáveis, cada CT-e permanece individual (não supor vínculo).
  function buildTrips(rows){
    const docs=mergeSameDocument(rows),groups=new Map();
    for(const doc of docs){
      const validPlate=doc.plate.length>=6 && doc.day;
      const key=validPlate?`${doc.plate}|${doc.day}`:`CTE|${doc.agency}|${doc.code}|${doc.day}|${groups.size}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(doc);
    }
    const result=[];
    for(const batch of groups.values()){
      const legs=batch.slice().sort((a,b)=>(a.date-b.date)||(safe(a.code)-safe(b.code)));
      // Agrupar clientes da viagem exclusivamente para corrigir a duplicação fiscal
      // das operações PR -> ES -> destino final. Não altera a unidade placa+dia.
      const payerGroups=[];
      for(const leg of legs){
        let payerGroup=payerGroups.find(g=>samePayer(g[0],leg));
        if(!payerGroup){payerGroup=[];payerGroups.push(payerGroup);}
        payerGroup.push(leg);
      }
      // Cada CT-e pode conter uma ou mais NFs. Caso haja reemissão com as MESMAS
      // chaves de NF, apenas o maior valor e peso são considerados para aquele
      // conjunto fiscal. Sem chave, utiliza-se o CT-e individual.
      const sumDistinct=(items,field)=>{
        const unique=new Map();
        for(const leg of items){
          const invoiceKeys=[...new Set(leg.rows.flatMap(r=>(String(r.nr_chave_nf||'').match(/\d{44}/g)||[])))].sort();
          const sig=invoiceKeys.length?`NFE:${invoiceKeys.join('|')}`:`CTE:${leg.agency}|${leg.code}|${leg.day}|${leg.plate}`;
          unique.set(sig,Math.max(unique.get(sig)||0,Math.max(0,safe(leg[field]))));
        }
        return [...unique.values()].reduce((s,v)=>s+v,0);
      };
      let nfValue=0,weight=0,driverFreight=0,joined=false;
      let first=legs[0],last=legs[legs.length-1];
      for(const pg of payerGroups){
        const origins=pg.filter(x=>x.origUF==='PR'&&x.destUF==='ES');
        const finals=pg.filter(x=>x.origUF==='ES');
        const paired=[];
        for(const origin of origins){
          const next=finals.filter(x=>x.date>=origin.date&&(x.date-origin.date)<=16*3600000&&sameTransferPoint(origin,x))
                           .sort((a,b)=>a.date-b.date);
          if(next.length)paired.push([origin,next[next.length-1]]);
        }
        if(paired.length){
          joined=true;
          const matchedSources=new Set(paired.map(x=>x[0]));
          const matchedFinals=new Set(paired.map(x=>x[1]));
          const others=pg.filter(x=>!matchedSources.has(x)&&!matchedFinals.has(x));
          // NF e peso das pernas de troca são alternativos, nunca cumulativos.
          nfValue+=Math.max(sumDistinct([...matchedSources],'value'),sumDistinct([...matchedFinals],'value'))+sumDistinct(others,'value');
          weight+=Math.max(sumDistinct([...matchedSources],'weight'),sumDistinct([...matchedFinals],'weight'))+sumDistinct(others,'weight');
          // A rota utiliza a origem cronologicamente inicial e o destino final
          // do último CT-e, inclusive quando há mudança de NF no Espírito Santo.
          // Frete motorista: preservar os CT-es de pagamento distintos; apenas
          // duplicidade positiva IDÊNTICA nas duas pernas é descontada uma vez.
          let costs=pg.reduce((s,x)=>s+x.driverFreight,0);
          const sourceCosts=[...matchedSources].map(x=>x.driverFreight).filter(x=>x>0);
          const finalCosts=[...matchedFinals].map(x=>x.driverFreight).filter(x=>x>0);
          for(const v of sourceCosts){const idx=finalCosts.findIndex(c=>Math.abs(c-v)<.005);if(idx>=0){costs-=v;finalCosts.splice(idx,1);}}
          driverFreight+=Math.max(0,costs);
        }else{
          nfValue+=sumDistinct(pg,'value');
          weight+=sumDistinct(pg,'weight');
          driverFreight+=pg.reduce((s,x)=>s+x.driverFreight,0);
        }
      }
      const driverLeg=legs.find(x=>x.driver && x.cpf) || legs.find(x=>x.driver) || first;
      const biggest=legs.slice().sort((a,b)=>b.value-a.value)[0];
      result.push({
        date:legs[0].date,ctes:legs.map(x=>x.code),joined,plate:legs[0].plate,
        payer:legs[0].payer,origCity:first.origCity,origUF:first.origUF,
        destCity:last.destCity,destUF:last.destUF,
        driver:driverLeg.driver,cpf:driverLeg.cpf,weight,nfValue,driverFreight,
        product:biggest?.product||'NÃO INFORMADO',legCount:legs.length
      });
    }
    return result;
  }
  function routeRank(trips,kind){
    const groups=new Map();
    for(const t of trips){
      const a=kind==='uf'?t.origUF:t.origCity, b=kind==='uf'?t.destUF:t.destCity;
      if(!isValid(a)||!isValid(b))continue;
      const key=kind==='uf'?`${a} → ${b}`:`${a}/${t.origUF} → ${b}/${t.destUF}`;
      if(!groups.has(key))groups.set(key,{label:key,count:0,weight:0});
      const g=groups.get(key);g.count++;g.weight+=t.weight;
    }
    return sorted([...groups.values()]).slice(0,10);
  }
  const bands=[
    {label:'Até R$ 300 mil',min:0,max:300000},
    {label:'Acima de 300 até 500 mil',min:300000,max:500000},
    {label:'Acima de 500 até 750 mil',min:500000,max:750000},
    {label:'Acima de 750 até 999 mil',min:750000,max:1000000},
    {label:'R$ 1 milhão ou mais',min:1000000,max:Infinity}
  ];
  function bandIndex(n){if(n<=0)return -1;if(n<=300000)return 0;if(n<=500000)return 1;if(n<=750000)return 2;if(n<1000000)return 3;return 4;}
  function riskMetrics(trips){
    const counts=bands.map((b,i)=>({...b,count:0,total:0,index:i}));const products=new Map();const high=[];let without=0;
    for(const t of trips){
      const b=bandIndex(t.nfValue);
      if(b<0){without++;continue;}
      counts[b].count++;counts[b].total+=t.nfValue;
      const name=t.product||'NÃO INFORMADO';
      if(!products.has(name))products.set(name,{label:name,count:0,bands:[0,0,0,0,0]});
      const g=products.get(name);g.count++;g.bands[b]++;
      if(b>=1)high.push(t);
    }
    return {bands:counts,products:sorted([...products.values()]).slice(0,10),high:high.sort((a,b)=>b.nfValue-a.nfValue).slice(0,20),without,totalWithInvoice:trips.length-without};
  }
  function driversRank(trips){
    const map=new Map();
    for(const t of trips){
      const cpf=digits(t.cpf),name=clean(t.driver);
      if(!cpf&&!name)continue;
      const key=cpf||'N:'+name;
      if(!map.has(key))map.set(key,{label:t.driver||'Não informado',count:0,freight:0,weight:0,plates:new Set()});
      const d=map.get(key);d.count++;d.freight+=t.driverFreight;d.weight+=t.weight;
      if(t.plate)d.plates.add(t.plate);
    }
    return sorted([...map.values()]).slice(0,20);
  }

  // API estável para auditoria automatizada, sem alterar o painel existente.
  host.InfinitiIndicadoresOperacionais = {emissions,buildTrips,routeRank,riskMetrics,driversRank,bandIndex,normalizeProduct};

  if(typeof document==='undefined')return;
  // Visual ESCURO OFICIAL V6/V11/V20. Estilização isolada em io-*;
  // não modifica classes nem regras dos componentes já publicados.
  const styles=`
    .io-section{display:grid;gap:22px;margin:22px 18px 24px;min-width:0;width:auto;color:#f7f9fc;font-family:"Segoe UI",Arial,sans-serif}
    .io-panel.card{display:block!important;min-width:0!important;min-height:0!important;width:100%!important;margin:0!important;padding:22px 24px!important;overflow:hidden!important;background:#121b26!important;border:1px solid #2a394b!important;border-radius:12px!important;box-shadow:none!important;color:#f7f9fc!important}
    .io-panel.card h3{font-size:17px!important;font-weight:800!important;color:#f7f9fc!important;margin:0 0 18px!important;line-height:1.25!important;padding:0!important}
    .io-panel.card h3:after{content:""!important;display:block!important;width:42px!important;height:3px!important;background:#f2a900!important;border-radius:3px!important;margin-top:9px!important}
    .io-panel .io-subhead{color:#e1eaf4;font-size:13px;font-weight:750;margin:4px 0 13px}
    .io-panel .io-explainer{color:#91a2b5;font-size:11px;line-height:1.55;margin:-7px 0 15px}
    .io-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;min-width:0}
    .io-grid>*{min-width:0}
    .io-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px;min-width:0}
    .io-metric{min-width:0;background:linear-gradient(145deg,#172230,#101a26);border:1px solid #2a394b;border-radius:8px;padding:14px 16px;min-height:82px;display:flex;flex-direction:column;justify-content:space-between}
    .io-metric small{display:block;order:-1;color:#9eafc2;font-size:10px;line-height:1.3;text-transform:uppercase;letter-spacing:.45px;margin:0 0 8px}
    .io-metric strong{display:block;color:#ffc52f;font-size:clamp(17px,1.35vw,23px);line-height:1.15;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    .io-control-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px;color:#9fb0c3;font-size:11px}
    .io-control-row label{color:#9fb0c3;font-size:11px;font-weight:700}
    .io-select{background:#141e2a;color:#fff;border:1px solid #405066;border-radius:5px;height:35px;padding:6px 11px;outline:none;font:12px "Segoe UI",Arial,sans-serif}
    .io-select:focus{border-color:#f2a900}
    .io-scroll{max-height:475px;overflow:auto;min-width:0;border:1px solid #27384a;border-radius:7px;background:#121b26}
    .io-scroll-compact{max-height:420px}
    .io-table{border-collapse:collapse;border-spacing:0;width:100%;min-width:440px;background:#121b26;color:#dbe3ec;font-size:11px;font-variant-numeric:tabular-nums}
    .io-table th{position:sticky;top:0;z-index:1;background:#172230;color:#9fb0c3;font-size:10px;text-transform:uppercase;letter-spacing:.35px;font-weight:700;white-space:nowrap;text-align:left;padding:13px 12px;border-bottom:1px solid #2a394b}
    .io-table td{color:#dbe3ec;padding:12px;border-bottom:1px solid #202d3b;white-space:nowrap;text-align:left}
    .io-table tbody tr:nth-child(even){background:#182432}
    .io-table tbody tr:hover{background:#1d2d40}
    .io-table .io-emphasis{color:#ffc52f;font-weight:800}
    .io-table .io-right{text-align:right!important}
    .io-note{color:#91a2b5;font-size:11px;line-height:1.5;margin:15px 0 1px}
    .io-mini-bars{display:grid;gap:10px;padding:2px 0 0}
    .io-bar{display:grid;grid-template-columns:minmax(90px,1.15fr) minmax(90px,2.3fr) minmax(45px,auto);gap:10px;align-items:center;font-size:11px;min-width:0}
    .io-bar-label{color:#b8c5d3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .io-bar-track{height:21px;overflow:hidden;background-color:#0d151f;background-image:linear-gradient(to right,transparent 24.7%,#263548 25%,transparent 25.3%,transparent 49.7%,#263548 50%,transparent 50.3%,transparent 74.7%,#263548 75%,transparent 75.3%);border-left:1px solid #415168;border-radius:3px}
    .io-bar-fill{height:100%;min-width:0;background:linear-gradient(90deg,#6389ad,#7ba0c4);border-radius:2px}
    .io-bar-value{text-align:right;color:#ffc52f;font-weight:800;white-space:nowrap}
    @media(max-width:1000px){.io-grid{grid-template-columns:1fr}.io-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.io-section{margin:20px 12px}}
    @media(max-width:620px){.io-kpis{grid-template-columns:1fr}.io-panel.card{padding:18px 14px!important}.io-bar{grid-template-columns:minmax(75px,1fr) minmax(85px,1.5fr) 50px;gap:6px}.io-section{gap:14px}}
  `;
  const existingStyle=document.getElementById('io-addons-style');if(!existingStyle){const style=document.createElement('style');style.id='io-addons-style';style.textContent=styles;document.head.appendChild(style);}
  let section=document.getElementById('indicadores-operacionais-infiniti');
  if(!section){
    section=document.createElement('section');
    section.id='indicadores-operacionais-infiniti';
    section.className='io-section';
    section.setAttribute('aria-label','Indicadores comerciais e operacionais adicionais');
    section.innerHTML=`
      <section class="card io-panel" id="io-prod-section">
        <h3>Produtividade do Faturamento</h3>
        <div class="io-kpis" id="io-emission-kpis"></div>
        <div class="io-grid">
          <div><div class="io-subhead">Emissões por colaborador</div><div class="io-scroll"><table class="io-table"><thead><tr><th>Colaborador emissor</th><th class="io-right">Emissões</th><th class="io-right">Participação</th></tr></thead><tbody id="io-emitters"></tbody></table></div></div>
          <div><div class="io-control-row"><label for="io-grain">Evolução por período</label><select class="io-select" id="io-grain"><option value="dia">Dia</option><option value="semana">Semana</option><option value="mes" selected>Mês</option><option value="trimestre">Trimestre</option><option value="ano">Ano</option></select></div><div id="io-trend" class="io-mini-bars"></div></div>
        </div>
        <p class="io-note">Emissões por colaborador, com identificação do CT-e por filial, data e veículo. O KPI original de CT-es permanece inalterado.</p>
      </section>
      <section class="card io-panel" id="io-routes-section">
        <h3>Top 10 Rotas Transportadas</h3>
        <div class="io-kpis" id="io-route-kpis"></div>
        <div class="io-grid">
          <div><div class="io-subhead">Rotas por cidade</div><div class="io-scroll"><table class="io-table"><thead><tr><th>Origem → Destino</th><th class="io-right">Viagens</th><th class="io-right">Peso (t)</th></tr></thead><tbody id="io-city-routes"></tbody></table></div></div>
          <div><div class="io-subhead">Rotas por estado</div><div class="io-scroll"><table class="io-table"><thead><tr><th>UF Origem → UF Destino</th><th class="io-right">Viagens</th><th class="io-right">Peso (t)</th></tr></thead><tbody id="io-state-routes"></tbody></table></div></div>
        </div>
        <p class="io-note">Uma viagem por placa e dia de emissão. CT-es adicionais da mesma operação não geram novas viagens; rota consolidada pela primeira origem e pelo último destino, com tratamento específico para trocas de NF no ES.</p>
      </section>
      <section class="card io-panel" id="io-risk-section">
        <h3>Gerenciamento de Risco · Valor da Mercadoria</h3>
        <div class="io-kpis" id="io-risk-kpis"></div>
        <div class="io-grid">
          <div><div class="io-subhead">Distribuição por faixa de valor fiscal</div><div class="io-scroll"><table class="io-table"><thead><tr><th>Valor da carga (NF)</th><th class="io-right">Viagens</th><th class="io-right">Valor das notas</th></tr></thead><tbody id="io-risk-bands"></tbody></table></div></div>
          <div><div class="io-subhead">Top 10 produtos e faixas de risco</div><div class="io-scroll"><table class="io-table"><thead><tr><th>Produto principal</th><th class="io-right">Viagens</th><th class="io-right">≤300 mil</th><th class="io-right">300–500 mil</th><th class="io-right">500–750 mil</th><th class="io-right">750 mil–1 mi</th><th class="io-right">≥1 mi</th></tr></thead><tbody id="io-products"></tbody></table></div></div>
        </div>
        <div class="io-subhead" style="margin-top:24px">20 maiores exposições de risco · Auditoria</div>
        <div class="io-scroll io-scroll-compact"><table class="io-table"><thead><tr><th>Emissão</th><th>CT-e(s)</th><th>Placa</th><th>Cliente</th><th>Produto</th><th>Rota consolidada</th><th class="io-right">Valor NF</th></tr></thead><tbody id="io-high-risk"></tbody></table></div>
        <p class="io-note">Para operações com troca de NF, o valor fiscal é o maior entre as emissões vinculadas, sem somatória indevida.</p>
      </section>
      <section class="card io-panel" id="io-drivers-section">
        <h3>Motoristas Recorrentes · Top 20</h3>
        <div class="io-scroll"><table class="io-table"><thead><tr><th>#</th><th>Motorista</th><th class="io-right">Viagens</th><th class="io-right">Frete motorista</th><th class="io-right">Peso (t)</th><th class="io-right">Placa(s)</th></tr></thead><tbody id="io-drivers"></tbody></table></div>
        <p class="io-note">Motoristas agrupados por CPF (ou nome quando indisponível). Viagens consolidadas por placa e data de emissão; CT-es do mesmo veículo/dia não multiplicam viagens. Frete motorista conforme valores lançados nos CT-es.</p>
      </section>`;
    // Adicionar DEPOIS de todos os indicadores e do detalhamento originais,
    // ANTES do rodapé, sem mover nenhum componente existente.
    const footer=document.querySelector('main > .footer.gh-product-footer, main > .footer');
    if(footer){footer.insertAdjacentElement('beforebegin',section);}
    else {
      const details=document.querySelector('#tbody')?.closest('section.card');
      if(details){details.insertAdjacentElement('afterend',section);}
      else{document.querySelector('main')?.appendChild(section);}
    }
  }
  const $=id=>document.getElementById(id);
  const metric=(value,label)=>`<div class="io-metric"><strong>${escape(value)}</strong><small>${escape(label)}</small></div>`;
  const noData=(cols)=>`<tr><td colspan="${cols}" style="color:#91a2b5;text-align:center">Sem registros para o período e os filtros selecionados.</td></tr>`;
  const routesRows=(arr)=>arr.length?arr.map(o=>`<tr><td>${escape(o.label)}</td><td class="io-right io-emphasis">${fmt(o.count)}</td><td class="io-right">${fmt(o.weight,2)}</td></tr>`).join(''):noData(3);
  // Apenas 3 cartões adicionais nos KPIs principais, sem substituir o render() oficial.
  // Os dados vêm da MESMA função filtered() utilizada pelos sete cartões originais.
  function syncMainCostKpis(rows){
    const panel=document.getElementById('kpis');
    if(!panel)return;
    if(!document.getElementById('io-main-cost-kpis-style')){
      const style=document.createElement('style');
      style.id='io-main-cost-kpis-style';
      // Duas linhas de cinco cartões no desktop; mesma responsividade do BI original.
      style.textContent=`
        @media(min-width:1501px){#kpis.kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}}
        @media(min-width:901px) and (max-width:1500px){#kpis.kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
        @media(min-width:561px) and (max-width:900px){#kpis.kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
        @media(max-width:560px){#kpis.kpis{grid-template-columns:1fr!important}}
      `;
      document.head.appendChild(style);
    }
    const extras=[
      {id:'io-kpi-frete-motorista',label:'Frete motorista',field:'vl_frete_motorista',subtitle:'Soma de vl_frete_motorista',icon:'<svg viewBox="0 0 24 24"><rect x="2" y="6" width="13" height="11" rx="1"/><path d="M15 10h4l3 3v4h-7M5 17h1m9 0h1"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>'},
      {id:'io-kpi-pedagio-motorista',label:'Pedágio motorista',field:'vl_pedagio_motorista',subtitle:'Soma de vl_pedagio_motorista',icon:'<svg viewBox="0 0 24 24"><path d="M3 20V9l9-5 9 5v11M2 10h20M8 10v10M16 10v10M3 15h18"/></svg>'},
      {id:'io-kpi-icms-iss',label:'ICMS/ISS',field:'vl_icms_issqn',subtitle:'Soma de vl_icms_issqn',icon:'<svg viewBox="0 0 24 24"><path d="M4 2h13l3 3v17l-4-2-4 2-4-2-4 2zM8 9h8M8 13h8M8 17h5"/></svg>'}
    ];
    const reference=panel.querySelector('.kpi');
    if(!reference)return;
    let anchor=[...panel.children].find(el=>el.classList.contains('kpi')&&el.querySelector('.t')?.textContent.trim()==='Resultado Total');
    if(!anchor)return; // Não altera o painel se o esquema original deixar de coincidir.
    for(const c of extras){
      let card=document.getElementById(c.id);
      if(!card){
        card=reference.cloneNode(true);
        card.id=c.id;
        const icon=card.querySelector('.kpi-icon');
        if(icon)icon.innerHTML=c.icon;
        const title=card.querySelector('.t');if(title)title.textContent=c.label;
        const detail=card.querySelector('.s');if(detail)detail.textContent=c.subtitle;
        panel.insertBefore(card,anchor);
      }
      const total=rows.reduce((sum,r)=>sum+safe(r[c.field]),0);
      const value=card.querySelector('.v');
      if(value)value.textContent=money(total);
    }
  }

  // Outras receitas: cartões aditivos, com as MESMAS linhas de filtered() do painel principal.
  // Não altera Faturamento, Resultado, Margem ou os cartões existentes.
  function syncOtherRevenueKpis(rows){
    const mainKpis=document.getElementById('kpis');
    if(!mainKpis)return;
    const template=mainKpis.querySelector('.kpi');
    if(!template)return;

    if(!document.getElementById('io-other-revenues-style')){
      const style=document.createElement('style');
      style.id='io-other-revenues-style';
      style.textContent=`
        .io-other-revenues{padding:0 18px;margin:0 0 26px}
        .io-other-revenues h3{font-size:16px;font-weight:800;color:var(--text,#f7f9fc);margin:0 0 14px;line-height:1.3}
        .io-other-revenues h3::after{content:'';display:block;width:44px;height:3px;background:var(--yellow,#ffc52f);border-radius:3px;margin-top:7px}
        .io-other-revenues-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;align-items:stretch}
        .io-other-revenues-grid .kpi{min-width:0}
        @media(min-width:1501px){.io-other-revenues-grid .kpi .v,.io-other-revenues-grid .kpi:first-child .v{font-size:clamp(17px,1.25vw,24px)!important}}
        @media(min-width:901px) and (max-width:1500px){.io-other-revenues-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(min-width:561px) and (max-width:900px){.io-other-revenues-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:560px){.io-other-revenues-grid{grid-template-columns:1fr}}
      `;
      document.head.appendChild(style);
    }

    let section=document.getElementById('io-other-revenues');
    if(!section){
      section=document.createElement('section');
      section.id='io-other-revenues';
      section.className='io-other-revenues';
      section.setAttribute('aria-label','Outras receitas');
      section.innerHTML='<h3>Outras receitas</h3><div class="io-other-revenues-grid" id="io-other-revenues-grid"></div>';
      mainKpis.insertAdjacentElement('afterend',section);
    }
    const grid=document.getElementById('io-other-revenues-grid');
    if(!grid)return;

    const revenueCards=[
      {id:'io-kpi-seguro-descontado',label:'Seguro descontado motorista',field:'vl_seguro_descontado',subtitle:'Soma de vl_seguro_descontado',icon:'<svg viewBox="0 0 24 24"><path d="M12 2l8 4v5c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>'},
      {id:'io-kpi-taxa-adm',label:'Taxa administrativa',field:'vl_taxa_adm',subtitle:'Soma de vl_taxa_adm',icon:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>'}
    ];
    for(const item of revenueCards){
      let card=document.getElementById(item.id);
      if(!card){
        card=template.cloneNode(true);
        card.id=item.id;
        const icon=card.querySelector('.kpi-icon');if(icon)icon.innerHTML=item.icon;
        const label=card.querySelector('.t');if(label)label.textContent=item.label;
        const subtitle=card.querySelector('.s');if(subtitle)subtitle.textContent=item.subtitle;
        grid.appendChild(card);
      }
      const value=card.querySelector('.v');
      // Reproduz a função SOMA da planilha: células monetárias gravadas como texto não entram no total.
      // Não converter 'R$ 203,41' ou strings numéricas; somente valores nativos do Google Sheets.
      if(value)value.textContent=money(rows.reduce((sum,row)=>{
        const cell=row[item.field];
        return sum+(typeof cell==='number' && Number.isFinite(cell)?cell:0);
      },0));
    }
  }

  function draw(){
    const rows=typeof filtered==='function'?filtered():[];
    syncMainCostKpis(rows);
    syncOtherRevenueKpis(rows);
    const granularity=$('io-grain').value;
    const e=emissions(rows,granularity),trips=buildTrips(rows),risk=riskMetrics(trips),drivers=driversRank(trips);
    const swaps=trips.filter(t=>t.joined).length;
    $('io-emission-kpis').innerHTML=metric(fmt(e.total),'CT-es emitidos no período')+metric(fmt(e.people.length),'Colaboradores com emissão');
    $('io-emitters').innerHTML=e.people.length?e.people.map(p=>`<tr><td>${escape(p.label)}</td><td class="io-right io-emphasis">${fmt(p.count)}</td><td class="io-right">${e.total?fmt(100*p.count/e.total,2):'0,00'}%</td></tr>`).join(''):noData(3);
    const max=Math.max(1,...e.periods.map(p=>p.count));
    $('io-trend').innerHTML=e.periods.length?e.periods.slice(-45).map(p=>`<div class="io-bar"><div class="io-bar-label">${escape(p.label)}</div><div class="io-bar-track"><div class="io-bar-fill" style="width:${Math.max(0,100*p.count/max).toFixed(2)}%"></div></div><div class="io-bar-value">${fmt(p.count)}</div></div>`).join(''):'<p class="io-desc">Sem emissões no filtro.</p>';
    $('io-route-kpis').innerHTML=metric(fmt(trips.length),'Viagens consolidadas (placa + dia)')+metric(fmt(swaps),'Viagens consolidadas por troca de nota');
    $('io-city-routes').innerHTML=routesRows(routeRank(trips,'city'));
    $('io-state-routes').innerHTML=routesRows(routeRank(trips,'uf'));
    $('io-risk-kpis').innerHTML=metric(fmt(risk.totalWithInvoice),'Viagens com valor de NF')+metric(fmt(risk.without),'Viagens sem valor de NF')+metric(fmt(risk.bands.slice(1).reduce((sum,b)=>sum+b.count,0)),'Viagens acima de R$ 300 mil');
    $('io-risk-bands').innerHTML=risk.bands.map(b=>`<tr><td>${escape(b.label)}</td><td class="io-right io-emphasis">${fmt(b.count)}</td><td class="io-right">${money(b.total)}</td></tr>`).join('');
    $('io-products').innerHTML=risk.products.length?risk.products.map(p=>`<tr><td>${escape(p.label)}</td><td class="io-right io-emphasis">${fmt(p.count)}</td>${p.bands.map(v=>`<td class="io-right">${fmt(v)}</td>`).join('')}</tr>`).join(''):noData(7);
    $('io-high-risk').innerHTML=risk.high.length?risk.high.map(t=>`<tr><td>${escape(iso(t.date))}</td><td>${escape(t.ctes.join(', '))}</td><td>${escape(t.plate||'—')}</td><td title="${escape(t.payer||'')}">${escape((t.payer||'—').slice(0,42))}</td><td>${escape(t.product)}</td><td>${escape(`${t.origCity}/${t.origUF} → ${t.destCity}/${t.destUF}`)}</td><td class="io-right io-emphasis">${money(t.nfValue)}</td></tr>`).join(''):noData(7);
    $('io-drivers').innerHTML=drivers.length?drivers.map((d,i)=>`<tr><td>${i+1}</td><td>${escape(d.label)}</td><td class="io-right io-emphasis">${fmt(d.count)}</td><td class="io-right">${money(d.freight)}</td><td class="io-right">${fmt(d.weight,2)}</td><td class="io-right">${escape([...d.plates].sort().join(', ') || '—')}</td></tr>`).join(''):noData(6);
  }
  function safeDraw(){try{draw();}catch(err){console.error('[Infiniti] Novos indicadores:',err);section.querySelector('.io-subtitle').textContent='Os indicadores adicionais não puderam ser atualizados: '+(err?.message||err);}}
  let scheduled=false;
  function scheduleDraw(){
    if(scheduled)return;
    scheduled=true;
    const flush=()=>{scheduled=false;safeDraw();};
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(flush);else flush();
  }
  $('io-grain').addEventListener('change',scheduleDraw);
  for(const [id,evt] of [['agency','change'],['rep','change'],['payer','input'],['dateStart','change'],['dateEnd','change'],['brokers','change'],['reset','click'],['allB','click'],['clearB','click']]){
    $(id)?.addEventListener(evt,scheduleDraw);
  }
  // Qualquer renderização do painel principal recria o conteúdo de #kpis.
  // Observá-lo garante sincronização mesmo em alterações dos filtros customizados.
  const originalKpis=$('kpis');
  if(originalKpis && typeof MutationObserver==='function'){
    const observer=new MutationObserver(scheduleDraw);
    observer.observe(originalKpis,{childList:true});
  }
  safeDraw();
})();
