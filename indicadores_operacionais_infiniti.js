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
  function buildTrips(rows){
    const docs=mergeSameDocument(rows),byPlate=new Map(),singles=[];
    for(const d of docs){
      if(d.plate.length<6 || !d.day){singles.push(newTrip(d));continue;}
      const groupKey=d.plate+'|'+d.day;
      if(!byPlate.has(groupKey))byPlate.set(groupKey,[]);
      byPlate.get(groupKey).push(d);
    }
    const trips=[...singles];
    for(const docsAtPlate of byPlate.values()){
      docsAtPlate.sort((a,b)=>a.date-b.date || (safe(a.code)-safe(b.code)));
      const lines=[];
      for(const leg of docsAtPlate){
        let best=null,bestScore=-1;
        for(const journey of lines){
          const prev=journey.last;
          if(prev.date>leg.date || journey.first.origUF!=='PR' || prev.destUF!=='ES' || leg.origUF!=='ES' || !sameTransferPoint(prev,leg) || !samePayer(prev,leg))continue;
          const elapsed=(leg.date-prev.date)/60000;
          if(elapsed<0 || elapsed>16*60)continue;
          const score=(prev.destCity===leg.origCity?10:4)+(prev.cnpj && prev.cnpj===leg.cnpj?4:0)-elapsed/10000;
          if(score>bestScore){best=journey;bestScore=score;}
        }
        if(best){best.legs.push(leg);best.last=leg;best.joined=true;}
        else lines.push(newTrip(leg));
      }
      trips.push(...lines);
    }
    return trips.map(t=>{
      const ls=t.legs,first=t.first,last=t.last;
      const nfValues=ls.map(x=>x.value).filter(v=>v>0);
      // Nas trocas de NF, não somar os valores das notas das duas emissões.
      const nfValue=t.joined?Math.max(0,...nfValues):(first.value||0);
      // O peso é da carga física e não a soma das duas pernas de CT-e.
      const weight=t.joined?Math.max(...ls.map(x=>x.weight)):first.weight;
      const distinctDriverCosts=[];
      for(const leg of ls){if(leg.driverFreight>0&&!distinctDriverCosts.some(x=>Math.abs(x-leg.driverFreight)<.005))distinctDriverCosts.push(leg.driverFreight);}
      // Primeiro a quantidade por viagem; frete motorista é somado apenas uma vez por valor de perna.
      const driverFreight=distinctDriverCosts.reduce((a,b)=>a+b,0);
      const principal=ls.slice().sort((a,b)=>b.value-a.value)[0];
      return {
        date:first.date,ctes:ls.map(l=>l.code),joined:t.joined,plate:first.plate,
        payer:first.payer,origCity:first.origCity,origUF:first.origUF,destCity:last.destCity,destUF:last.destUF,
        driver:first.driver||last.driver,cpf:first.cpf||last.cpf,weight,nfValue,driverFreight,
        product:principal?.product||'NÃO INFORMADO',legCount:ls.length
      };
    });
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
        <p class="io-note">Em viagens com troca de nota fiscal, considera origem do primeiro CT-e e destino final do último CT-e, conforme critérios de consolidação aprovados.</p>
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
        <p class="io-note">Motoristas agrupados por CPF (ou nome quando indisponível). Viagens e peso sem duplicar trocas de nota; frete motorista conforme o documento fiscal.</p>
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
  function draw(){
    const rows=typeof filtered==='function'?filtered():[];
    const granularity=$('io-grain').value;
    const e=emissions(rows,granularity),trips=buildTrips(rows),risk=riskMetrics(trips),drivers=driversRank(trips);
    const swaps=trips.filter(t=>t.joined).length;
    $('io-emission-kpis').innerHTML=metric(fmt(e.total),'CT-es emitidos no período')+metric(fmt(e.people.length),'Colaboradores com emissão');
    $('io-emitters').innerHTML=e.people.length?e.people.map(p=>`<tr><td>${escape(p.label)}</td><td class="io-right io-emphasis">${fmt(p.count)}</td><td class="io-right">${e.total?fmt(100*p.count/e.total,2):'0,00'}%</td></tr>`).join(''):noData(3);
    const max=Math.max(1,...e.periods.map(p=>p.count));
    $('io-trend').innerHTML=e.periods.length?e.periods.slice(-45).map(p=>`<div class="io-bar"><div class="io-bar-label">${escape(p.label)}</div><div class="io-bar-track"><div class="io-bar-fill" style="width:${Math.max(0,100*p.count/max).toFixed(2)}%"></div></div><div class="io-bar-value">${fmt(p.count)}</div></div>`).join(''):'<p class="io-desc">Sem emissões no filtro.</p>';
    $('io-route-kpis').innerHTML=metric(fmt(trips.length),'Viagens físicas no filtro')+metric(fmt(swaps),'Viagens consolidadas por troca de nota');
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
