/* === TP connection setup === */
var TP_CONFIG_KEY = "TP_macrodeck_connection_v2";
var TP_DEFAULT_PORT = "8080";

function TPGetConfig(){
  try{
    var raw=localStorage.getItem(TP_CONFIG_KEY);
    if(raw){
      var cfg=JSON.parse(raw);
      if(cfg && cfg.ip && cfg.port)return cfg;
    }
  }catch(e){}
  return null;
}
function TPSaveConfig(ip,port){
  var cfg={ip:String(ip).replace(/^\s+|\s+$/g,""),port:String(port).replace(/^\s+|\s+$/g,"")};
  localStorage.setItem(TP_CONFIG_KEY,JSON.stringify(cfg));
  return cfg;
}
function TPClearConfig(){
  try{localStorage.removeItem(TP_CONFIG_KEY);}catch(e){}
}
function TPShowSetup(message){
  try{document.body.classList.add("tp-setup-open");}catch(e){}
  var old=document.getElementById("TPSetupOverlay");
  if(old && old.parentNode)old.parentNode.removeChild(old);
  try{document.body.classList.remove("tp-setup-open");}catch(e){}

  var cfg=TPGetConfig() || {ip:"",port:TP_DEFAULT_PORT};
  var ov=document.createElement("div");
  ov.id="TPSetupOverlay";
  ov.innerHTML=
    '<div class="TPSetupCard">'+
      '<div class="TPSetupTitle">TP Macro Deck</div>'+
      '<div class="TPSetupSub">Bağlantı ayarları</div>'+
      '<label>Bağlantı Modu</label>'+
      '<select id="TPMode" style="display:block;width:100%;height:44px;margin:0 0 14px;padding:0 10px;box-sizing:border-box;border:1px solid #555d69;border-radius:7px;background:#252a32;color:#fff;font-size:16px">'+
        '<option value="wifi">Wi-Fi</option>'+
        '<option value="usb">USB (Özel Protokol)</option>'+
      '</select>'+
      '<label>PC IP Adresi</label>'+
      '<input id="TPIp" type="text" placeholder="192.168.1.100" autocapitalize="off" autocorrect="off">'+
      '<label>Bridge Port</label>'+
      '<input id="TPPort" type="text" value="8080" autocapitalize="off" autocorrect="off">'+
      '<button id="TPConnectBtn" type="button">BAĞLAN</button>'+
      '<div id="TPSetupStatus"></div>'+
    '</div>';

  document.body.appendChild(ov);

  document.getElementById("TPIp").value=cfg.ip;
  document.getElementById("TPPort").value=cfg.port || TP_DEFAULT_PORT;
  if(document.getElementById("TPMode")){
    document.getElementById("TPMode").value=(localStorage.getItem("TP_mode")||"wifi");
  }

  if(message){
    document.getElementById("TPSetupStatus").innerHTML=message;
  }

  document.getElementById("TPConnectBtn").onclick=function(){
    var ip=document.getElementById("TPIp").value.replace(/^\s+|\s+$/g,"");
    var port=document.getElementById("TPPort").value.replace(/^\s+|\s+$/g,"");
    var st=document.getElementById("TPSetupStatus");
    var mode=document.getElementById("TPMode") ? document.getElementById("TPMode").value : "wifi";
    try{localStorage.setItem("TP_mode",mode);}catch(e){}

    if(mode==="usb"){
      TPStartUsbProtocol();
      return;
    }

    // Switching USB -> Wi-Fi must release the USB socket first.
    TPStopCurrentTransport();

    if(!ip){
      st.innerHTML="IP adresini girin.";
      return;
    }

    if(!/^[0-9.]+$/.test(ip)){
      st.innerHTML="Geçerli bir IPv4 adresi girin.";
      return;
    }

    if(!/^[0-9]+$/.test(port) ||
       parseInt(port,10)<1 ||
       parseInt(port,10)>65535){
      st.innerHTML="Geçerli bir port girin.";
      return;
    }

    st.innerHTML="TP Client kontrol ediliyor...";

    var xhr=new XMLHttpRequest();
    xhr.open("GET","http://"+ip+":"+port+"/",true);
    xhr.timeout=5000;

    xhr.onreadystatechange=function(){
      if(xhr.readyState!==4)return;

      if(xhr.status>=200 && xhr.status<500){
        TPSaveConfig(ip,port);
        st.innerHTML="Bağlantı başarılı. Açılıyor...";

        window.setTimeout(function(){
          var overlay=document.getElementById("TPSetupOverlay");
          if(overlay && overlay.parentNode){
            overlay.parentNode.removeChild(overlay);
          }

          connect();
        },150);

      }else{
        st.innerHTML=
          "Bağlantı kurulamadı. IP, port ve Windows Firewall'u kontrol edin.";
      }
    };

    xhr.onerror=function(){
      st.innerHTML=
        "Client'a istek gidiyor ancak cevap alınamıyor. Client ve 8080 portunu kontrol edin.";
    };

    xhr.ontimeout=function(){
      st.innerHTML="Bağlantı zaman aşımına uğradı.";
    };

    try{
      xhr.send(null);
    }catch(e){
      st.innerHTML="Bağlantı başlatılamadı.";
    }
  };
}

function TPOpenConnectionSettings(){
  TPShowSetup("");
}

function TPConfiguredHost(){
  var cfg=TPGetConfig();
  if(cfg && cfg.ip)return cfg.ip;
  return "";
}

/* TP Android 4.2.2 Macro Deck legacy client
   No CSS Grid / Flexbox / ES6. Uses old HTML table layout. */

var ws=null, connected=false;
var TP_CLIENT_ID_KEY="TP_macrodeck_client_id_v1";
var clientId=(function(){
  try{
    var v=localStorage.getItem(TP_CLIENT_ID_KEY);
    if(v)return v;
    v="TP_"+Math.random().toString(36).substr(2,8);
    localStorage.setItem(TP_CLIENT_ID_KEY,v);
    return v;
  }catch(e){
    return "TP_"+Math.random().toString(36).substr(2,8);
  }
})();
var apiVersion=20, config={Columns:5,Rows:3}, buttons=[], icons={IconPacks:[]};
var supportRelease=false, reconnectTimer=null, pressTimers={};
var httpFallback=false, httpPolling=false, httpSid=null, wsAttempting=false, wsFallbackTimer=null;

var M={CONNECTED:"CONNECTED",GET_CONFIG:"GET_CONFIG",GET_BUTTONS:"GET_BUTTONS",
UPDATE_BUTTON:"UPDATE_BUTTON",UPDATE_LABEL:"UPDATE_LABEL",GET_ICONS:"GET_ICONS",
BUTTON_PRESS:"BUTTON_PRESS",BUTTON_LONG_PRESS:"BUTTON_LONG_PRESS",
BUTTON_RELEASE:"BUTTON_RELEASE",BUTTON_LONG_PRESS_RELEASE:"BUTTON_LONG_PRESS_RELEASE"};

var TP_USB_ACTIVE=false;
var TP_USB_CONNECTED=false;

function TPUsbSend(o){
  try{
    if(window.TPNative && TPNative.send){
      TPNative.send(JSON.stringify(o));
      return true;
    }
  }catch(e){
    try{
      var st=document.getElementById("status");
      if(st)st.innerHTML="USB gönderim hatası: "+e.message;
    }catch(ignore){}
  }
  return false;
}


window.TPNativeStatus=function(text){
  var e=document.getElementById("TPSetupStatus");
  if(e){
    e.innerHTML=text;
  }
  if(typeof setStatus==="function"){
    setStatus(text,text==="USB_SERVER_READY"?"#7f7":"#fc6");
  }
};

window.TPUsbReceive=function(text){
  try{
    var o=JSON.parse(text);
    if(o && o.type==="hello") return;
    handle(o);
  }catch(e){}
};

function TPUsbSetupStatus(text,color){
  var e=document.getElementById("TPSetupStatus");
  if(e){
    e.innerHTML=text;
    e.style.color=color||"#fff";
  }
  setStatus(text,color);
}

function TPHideSetup(){
  var ov=document.getElementById("TPSetupOverlay");
  if(ov && ov.parentNode)ov.parentNode.removeChild(ov);
  try{document.body.classList.remove("tp-setup-open");}catch(e){}
}

function TPStopCurrentTransport(){
  // Stop Wi-Fi transport.
  if(wsFallbackTimer){
    clearTimeout(wsFallbackTimer);
    wsFallbackTimer=null;
  }
  wsAttempting=false;
  httpPolling=false;
  httpFallback=false;
  httpSid=null;

  if(ws){
    try{ws.onclose=null; ws.onerror=null; ws.close();}catch(e){}
    ws=null;
  }

  // Stop USB transport without stopping the Android native server.
  // This closes the current USB TCP connection so the PC client can
  // reconnect cleanly when USB mode is selected again.
  if(window.TPNative && TPNative.disconnectUsb){
    try{TPNative.disconnectUsb();}catch(e){}
  }

  TP_USB_ACTIVE=false;
  TP_USB_CONNECTED=false;
  connected=false;
  setConnectionUI(false);
}

function TPStartUsbProtocol(){
  TPStopCurrentTransport();
  var st=document.getElementById("TPSetupStatus");
  if(st)st.innerHTML="USB native sunucusu bekleniyor...";

  if(!window.TPNative){
    if(st)st.innerHTML="TPNative bridge bulunamadi.";
    return false;
  }

  var tries=0;
  var timer=setInterval(function(){
    tries++;
    try{
      if(TPNative.isUsbConnected()){
        clearInterval(timer);
        TP_USB_ACTIVE=true;
        TP_USB_CONNECTED=true;
        connected=true;
        setConnectionUI(true);
        if(st)st.innerHTML="USB bağlantısı kuruldu. Açılıyor...";
        try{localStorage.setItem("TP_mode","usb");}catch(e){}

        // The Windows TP Client sends the Macro Deck CONNECTED message
        // after the USB transport is verified. Do not send it twice here.

        window.setTimeout(function(){
          TPHideSetup();
        },300);
        return;
      }
    }catch(e){
      if(st)st.innerHTML="USB kontrol hatasi: "+e.message;
      clearInterval(timer);
      return;
    }

    if(tries>=40){
      clearInterval(timer);
      if(st)st.innerHTML="USB native sunucusuna bağlantı kurulamadı.";
    }else if(st){
      st.innerHTML="USB bağlantısı bekleniyor... ("+tries+"/40)";
    }
  },250);

  return true;
}


function setStatus(t,c){var e=document.getElementById("status");if(!e)return;e.innerHTML=t;e.style.color=c||"#fff";}
function host(){
 var h=TPConfiguredHost();
 if(h)return h;
 return "";
}

function setConnectionUI(ok){
 var dot=document.getElementById("statusDot");
 var s=document.getElementById("menuStatus");
 var server=document.getElementById("menuServer");
 if(dot)dot.style.backgroundColor=ok?"#38d66b":"#e34b4b";
 if(s){
   s.innerHTML=ok?"Bağlı":"Bağlantı yok";
   s.style.color=ok?"#38d66b":"#e34b4b";
 }
 if(server)server.innerHTML=(host()?host():"-")+":"+8191;
 updateFullscreenUI();
}
function updateFullscreenUI(){
 var f=document.getElementById("menuFullscreen");
 if(f)f.innerHTML=isFullscreen()?"Açık":"Kapalı";
}
function toggleStatusMenu(){
 var m=document.getElementById("statusMenu");
 if(!m)return;
 if(m.className=="open"){
   m.className="";
 }else{
   m.className="open";
   updateFullscreenUI();
 }
}
function manualReconnect(){
 TPStopCurrentTransport();
 if(wsFallbackTimer){clearTimeout(wsFallbackTimer);wsFallbackTimer=null;}
 var m=document.getElementById("statusMenu");
 if(m)m.className="";
 httpFallback=false;
 httpPolling=false;
 httpSid=null;
 if(ws){try{ws.close();}catch(e){}}
 connected=false;
 setConnectionUI(false);
 window.setTimeout(function(){connect();},150);
}

function connect(){
 TP_USB_ACTIVE=false;
 TP_USB_CONNECTED=false;
 var cfg=TPGetConfig();

 if(!cfg || !cfg.ip || !cfg.port){
   connected=false;
   setConnectionUI(false);
   setStatus("IP ve port ayarlanmadı","#fc6");
   TPShowSetup("");
   return;
 }

 httpFallback=false;
 httpPolling=false;
 httpSid=null;
 wsAttempting=true;

 if(ws){
   try{ws.close();}catch(e){}
   ws=null;
 }

 var h=host();

 if(!h){
   setStatus("PC IP yok","#f66");
   return;
 }

 setStatus("TP Client'a bağlanıyor: "+h+":"+cfg.port,"#fc6");

 if(typeof WebSocket=="undefined"){
   startHttpFallback(h);
   return;
 }

 try{
   ws=new WebSocket(
     "ws://"+h+":"+cfg.port+
     "/bridge/ws?sid="+encodeURIComponent(clientId)+
     "&host="+encodeURIComponent(h)
   );
 }catch(e){
   startHttpFallback(h);
   return;
 }

 if(wsFallbackTimer){
   clearTimeout(wsFallbackTimer);
 }

 wsFallbackTimer=setTimeout(function(){
   if(!connected && !httpFallback){
     startHttpFallback(h);
   }
 },5000);

 ws.onopen=function(){
   if(wsFallbackTimer){
     clearTimeout(wsFallbackTimer);
     wsFallbackTimer=null;
   }

   wsAttempting=false;
   connected=true;

   setStatus("Bağlandı","#7f7");
   setConnectionUI(true);

   // The TP Client creates the Macro Deck connection.
   // Only one stable CONNECTED message is sent per device session.
   send({
     Method:M.CONNECTED,
     "Client-Id":clientId,
     API:apiVersion,
     "Device-Type":"Web"
   });
 };

 ws.onmessage=function(ev){
   var o;
   try{
     o=JSON.parse(ev.data);
   }catch(e){
     return;
   }
   handle(o);
 };

 ws.onerror=function(){
   if(wsFallbackTimer){
     clearTimeout(wsFallbackTimer);
     wsFallbackTimer=null;
   }

   if(!connected){
     startHttpFallback(h);
   }else{
     setStatus("WebSocket hatası","#f66");
     setConnectionUI(false);
   }
 };

 ws.onclose=function(){
   if(wsFallbackTimer){
     clearTimeout(wsFallbackTimer);
     wsFallbackTimer=null;
   }

   if(!connected){
     startHttpFallback(h);
   }else{
     connected=false;
     setStatus("Bağlantı kesildi","#f66");
     setConnectionUI(false);
   }
 };
}


function startHttpFallback(h){
 if(httpFallback)return;
 httpFallback=true;
 wsAttempting=false;
 connected=false;
 try{if(ws)ws.close();}catch(e){}
 ws=null;

 setStatus("HTTP bağlantısı deneniyor...","#fc6");
 setConnectionUI(false);

 var xhr=new XMLHttpRequest();
 xhr.open("GET","http://"+h+":"+TPGetConfig().port+"/bridge/connect?sid="+encodeURIComponent(clientId)+"&host="+encodeURIComponent(h),true);
 xhr.onreadystatechange=function(){
   if(xhr.readyState!=4)return;
   if(xhr.status==200){
     try{
       var r=JSON.parse(xhr.responseText);
       httpSid=r.sid||clientId;
       connected=!!r.connected;
       setConnectionUI(connected);
       if(connected)setStatus("Macro Deck bağlı (HTTP)","#7f7");
       else setStatus("Macro Deck köprüsü hazır, bekleniyor...","#fc6");
       startHttpPolling();
     }catch(e){
       setStatus("HTTP köprü hatası","#f66");
     }
   }else{
     setStatus("HTTP köprü bağlantısı bekleniyor...","#fc6");
     setConnectionUI(false);
     window.setTimeout(function(){ if(!connected) startHttpFallback(h); },1500);
   }
 };
 try{xhr.send(null);}catch(e){setStatus("HTTP bağlantısı açılamadı","#f66");}
}

function startHttpPolling(){
 if(httpPolling)return;
 httpPolling=true;

 function poll(){
   if(!httpFallback){httpPolling=false;return;}
   var xhr=new XMLHttpRequest();
   xhr.open("GET","http://"+host()+":"+TPGetConfig().port+"/bridge/poll?sid="+encodeURIComponent(httpSid||clientId)+"&host="+encodeURIComponent(host()),true);
   xhr.onreadystatechange=function(){
     if(xhr.readyState!=4)return;
     if(xhr.status==200){
       try{
         var r=JSON.parse(xhr.responseText);
         if(r.sid) httpSid=r.sid;
         connected=!!r.connected;
         if(connected)setStatus("Macro Deck bağlı (HTTP)","#7f7");
         else setStatus("Bağlantı yok","#f66");
         setConnectionUI(connected);

         var a=r.messages||[],i;
         for(i=0;i<a.length;i++)handle(a[i]);
       }catch(e){}
     }else{
       connected=false;
       setConnectionUI(false);
       if(xhr.status==404){
         httpFallback=false;
         httpPolling=false;
         httpSid=null;
         startHttpFallback(host());
         return;
       }
     }
     /* Server uses long-polling. Start the next request only after the
        current request has returned; do not create a 250ms request storm. */
     window.setTimeout(poll,20);
   };
   try{xhr.send(null);}catch(e){window.setTimeout(poll,1000);}
 }
 poll();
}

function sendHttp(o){
 if(!httpFallback || !httpSid)return;
 var xhr=new XMLHttpRequest();
 xhr.open("POST","http://"+host()+":"+TPGetConfig().port+"/bridge/send?sid="+encodeURIComponent(httpSid)+"&host="+encodeURIComponent(host()),true);
 xhr.setRequestHeader("Content-Type","application/json");
 try{xhr.send(JSON.stringify(o));}catch(e){}
}

function send(o){
 if(TP_USB_ACTIVE){
   TPUsbSend(o);
   return;
 }
 if(httpFallback){
   if(connected)sendHttp(o);
   return;
 }
 if(ws&&connected){try{ws.send(JSON.stringify(o));}catch(e){}}
}

function handle(o){
 try{
  if(o.Method==M.GET_CONFIG){
    var newCols=parseInt(o.Columns,10)||5;
    var newRows=parseInt(o.Rows,10)||3;
    var sizeChanged=(config.Columns!=newCols || config.Rows!=newRows ||
                     !document.getElementById("b_0_0"));
    config.Columns=newCols;
    config.Rows=newRows;
    if(o.SupportButtonReleaseLongPress===true)supportRelease=true;

    /* Do not rebuild the grid when Macro Deck repeats CONNECTED/GET_CONFIG.
       Rebuilding destroys the current folder view and makes the page appear
       to refresh. Only rebuild if the actual grid size changed. */
    if(sizeChanged)renderGrid();

    /* Request data, but don't reset the current folder/view. */
    send({Method:M.GET_ICONS});
    send({Method:M.GET_BUTTONS});
    return;
  }
  if(o.Method==M.GET_ICONS){icons=o;drawButtons();return;}
  if(o.Method==M.GET_BUTTONS){buttons=o.Buttons||[];drawButtons();return;}
  if(o.Method==M.UPDATE_BUTTON){replaceButton(o.Buttons&&o.Buttons[0]);return;}
  if(o.Method==M.UPDATE_LABEL){replaceButton(o.Buttons&&o.Buttons[0]);return;}
  if(o.Method==M.REQUEST_PIN){
    var p=prompt("Macro Deck PIN:");
    if(p!==null)send({Method:"PIN",PIN:p});
  }
 }catch(e){}
}

function renderGrid(){
 var d=document.getElementById("deck"), html="<table class='md-table'><tbody>";
 var r=config.Rows,c=config.Columns,y,x;
 for(y=0;y<r;y++){
   html+="<tr>";
   for(x=0;x<c;x++){
     html+="<td class='md-cell'><div class='md-button empty' id='b_"+y+"_"+x+"' data-id='"+y+"_"+x+"'><div class='md-icon'></div><div class='md-label'></div></div></td>";
   }
   html+="</tr>";
 }
 html+="</tbody></table>"; d.innerHTML=html;
 for(y=0;y<r;y++)for(x=0;x<c;x++)bindButton(document.getElementById("b_"+y+"_"+x),y+"_"+x);
}

function IsTouchDevice(){
 return ('ontouchstart' in window) || (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0);
}
var activeButtons={};
var pressTimers={};

function IsTouchDevice(){
 return ('ontouchstart' in window) || (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0);
}

function bindButton(b,id){
 if(!b)return;

 if(IsTouchDevice()){
   b.ontouchstart=function(e){
     if(e&&e.preventDefault)e.preventDefault();
     press(id,b);
     return false;
   };
   b.ontouchend=function(e){
     if(e&&e.preventDefault)e.preventDefault();
     release(id,b);
     return false;
   };
   b.ontouchcancel=function(e){
     if(e&&e.preventDefault)e.preventDefault();
     release(id,b);
     return false;
   };
 }else{
   b.onmousedown=function(){press(id,b);};
   b.onmouseup=function(){release(id,b);};
   b.onmouseleave=function(){release(id,b);};
 }
}

function press(id,b){
 if(activeButtons[id])return;
 activeButtons[id]=b;

 /* Touch feedback: temporarily use the same visual hover color as Macro Deck. */
 var normal=b.getAttribute("data-normal-bg") || b.style.backgroundColor || "#333";
 b.setAttribute("data-normal-bg",normal);
 b.className="md-button";
 b.style.backgroundColor="#555";

 send({Message:id,Method:M.BUTTON_PRESS});

 if(supportRelease){
   pressTimers[id]=setTimeout(function(){
     send({Message:id,Method:M.BUTTON_LONG_PRESS});
   },1000);
 }
}

function release(id,b){
 if(!activeButtons[id])return;

 delete activeButtons[id];

 if(pressTimers[id]){
   clearTimeout(pressTimers[id]);
   delete pressTimers[id];
 }

 /* Restore exactly the color Macro Deck supplied before the tap. */
 var normal=b.getAttribute("data-normal-bg") || "#333";
 b.className="md-button";
 b.style.backgroundColor=normal;

 if(supportRelease)send({Message:id,Method:M.BUTTON_RELEASE});
}

function releaseAllTouches(){
 var id,b;
 for(id in activeButtons){
   if(activeButtons.hasOwnProperty(id)){
     b=activeButtons[id];
     release(id,b);
   }
 }
}

if(document.addEventListener){
 document.addEventListener("touchend",function(e){releaseAllTouches();},false);
 document.addEventListener("touchcancel",function(e){releaseAllTouches();},false);
 document.addEventListener("mouseup",function(e){releaseAllTouches();},false);
}

function findIcon(name){

 if(!icons||!icons.IconPacks)return null;
 var parts=(name||"").split(".");
 if(parts.length<2)return null;
 var p=null,i,j;
 for(i=0;i<icons.IconPacks.length;i++){
   if(icons.IconPacks[i].Name==parts[0]){p=icons.IconPacks[i];break;}
 }
 if(!p||!p.Icons)return null;
 for(j=0;j<p.Icons.length;j++){
   if(p.Icons[j].IconId==parts[1])return p.Icons[j];
 }
 return null;
}
function base64Mime(b64){
 if(!b64)return "image/png";
 if(b64.indexOf("R0lGOD")===0)return "image/gif";
 if(b64.indexOf("/9j/")===0)return "image/jpeg";
 if(b64.indexOf("iVBORw")===0)return "image/png";
 if(b64.indexOf("UklGR")===0)return "image/webp";
 return "image/png";
}
function setLabelImage(label,b64){
 if(!label)return;
 if(!b64){label.style.backgroundImage="";return;}
 label.style.backgroundImage="url(data:"+base64Mime(b64)+";base64,"+b64+")";
 label.style.backgroundRepeat="no-repeat";
 label.style.backgroundPosition="center center";
 label.style.backgroundSize="contain";
}
function setButtonIcon(icon,b64){
 if(!icon){return;}
 if(!b64){icon.style.backgroundImage="";return;}
 icon.style.backgroundImage="url(data:"+base64Mime(b64)+";base64,"+b64+")";
 icon.style.backgroundRepeat="no-repeat";
 icon.style.backgroundPosition="center center";
 icon.style.backgroundSize="contain";
}
function setButtonLabel(label,b){
 if(!label||!b)return;

 label.style.backgroundImage="";
 label.innerHTML="";
 label.style.color="#fff";
 label.style.fontSize="13px";
 label.style.lineHeight="20px";
 label.style.textAlign="center";

 var b64=null;
 if(b.Label && b.Label.LabelBase64)b64=b.Label.LabelBase64;
 if(b.LabelBase64)b64=b.LabelBase64;

 if(b64){
   setLabelImage(label,b64);
   label.style.backgroundSize="100% 100%";
   return;
 }

 /* Some clients/plugins can send a literal label instead of a rendered image. */
 var text=null;
 if(b.Label && typeof b.Label=="string")text=b.Label;
 else if(b.Label && b.Label.Text!=null)text=b.Label.Text;
 else if(b.LabelText!=null)text=b.LabelText;
 else if(b.Text!=null)text=b.Text;

 if(text!=null){
   label.innerHTML=String(text);
 }
}
function applyButton(b){
 if(!b)return;
 var y=parseInt(b.Position_Y,10),x=parseInt(b.Position_X,10);
 var el=document.getElementById("b_"+y+"_"+x);
 if(!el)return;

 el.className="md-button";

 var normalBg=b.BackgroundColorHex || "#333";
 el.style.backgroundColor=normalBg;
 el.setAttribute("data-normal-bg",normalBg);

 var divs=el.getElementsByTagName("div");
 var icon=divs[0],label=divs[1];

 var ib64=null;
 if(b.IconBase64)ib64=b.IconBase64;
 else if(b.Icon){
   var ic=findIcon(b.Icon);
   if(ic)ib64=ic.IconBase64;
 }
 setButtonIcon(icon,ib64);
 setButtonLabel(label,b);
}
function drawButtons(){
 var i,x,e;
 for(i=0;i<config.Rows;i++){
   for(x=0;x<config.Columns;x++){
     e=document.getElementById("b_"+i+"_"+x);
     if(e){
       e.className="md-button empty";
       e.style.backgroundColor="#333";
       e.getElementsByTagName("div")[0].style.backgroundImage="";
       e.getElementsByTagName("div")[1].style.backgroundImage="";
       e.getElementsByTagName("div")[1].innerHTML="";
     }
   }
 }
 for(i=0;i<buttons.length;i++)applyButton(buttons[i]);
}
function replaceButton(b){
 if(!b)return;
 var i;
 for(i=0;i<buttons.length;i++){
   if(parseInt(buttons[i].Position_Y,10)==parseInt(b.Position_Y,10)&&parseInt(buttons[i].Position_X,10)==parseInt(b.Position_X,10)){buttons[i]=b;break;}
 }
 if(i==buttons.length)buttons.push(b);
 applyButton(b);
}

var fullscreenState=false;

function isFullscreen(){
 return !!(
   fullscreenState ||
   document.fullscreenElement ||
   document.webkitFullscreenElement ||
   document.webkitFullScreenElement ||
   document.webkitIsFullScreen ||
   document.mozFullScreenElement ||
   document.mozFullScreen ||
   document.msFullscreenElement
 );
}

function goFullscreen(){
 try{
   var d=document.documentElement;

   if(isFullscreen()){
     fullscreenState=false;

     if(document.exitFullscreen){
       document.exitFullscreen();
     }else if(document.webkitExitFullscreen){
       document.webkitExitFullscreen();
     }else if(document.webkitCancelFullScreen){
       document.webkitCancelFullScreen();
     }else if(document.webkitCancelFullscreen){
       document.webkitCancelFullscreen();
     }else if(document.mozCancelFullScreen){
       document.mozCancelFullScreen();
     }else if(document.msExitFullscreen){
       document.msExitFullscreen();
     }
     updateFullscreenUI();
    return false;
   }

   if(d.requestFullscreen){
     d.requestFullscreen();
     fullscreenState=true;
   }else if(d.webkitRequestFullscreen){
     d.webkitRequestFullscreen();
     fullscreenState=true;
   }else if(d.webkitRequestFullScreen){
     d.webkitRequestFullScreen();
     fullscreenState=true;
   }else if(d.mozRequestFullScreen){
     d.mozRequestFullScreen();
     fullscreenState=true;
   }else if(d.msRequestFullscreen){
     d.msRequestFullscreen();
     fullscreenState=true;
   }
 }catch(e){
   fullscreenState=false;
 }
 updateFullscreenUI();
 return false;
}

/* Keep our state synchronized when Android/Chrome exits fullscreen
   with the system back button or another browser action. */
function fullscreenChanged(){
 if(!document.webkitIsFullScreen &&
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.mozFullScreen){
   fullscreenState=false;
 }
 updateFullscreenUI();
}
if(document.addEventListener){
 document.addEventListener("fullscreenchange",fullscreenChanged,false);
 document.addEventListener("webkitfullscreenchange",fullscreenChanged,false);
 document.addEventListener("mozfullscreenchange",fullscreenChanged,false);
}

window.onload=function(){
 setConnectionUI(false);
 var cfg=TPGetConfig();
  var mode="";
  try{mode=localStorage.getItem("TP_mode")||"";}catch(e){}
  if(mode==="usb"){
    if(!TPStartUsbProtocol()){
      setStatus("USB bağlantısı bekleniyor...","#fc6");
      setConnectionUI(false);
    }
    return;
  }
  if(!cfg || !cfg.ip || !cfg.port){
    TPShowSetup("");
  }else{
    connect();
  }
};
