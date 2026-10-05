
    spreadrWidgetCode = function(){






        (function ($) {
            var timer;

            function trackLeave(ev) {
                if (ev.clientY > 0) {
                    return;
                }

                if (timer) {
                    clearTimeout(timer);
                }

                if ($.exitIntent.settings.sensitivity <= 0) {
                    $.event.trigger('exitintent');
                    return;
                }

                timer = setTimeout(
                    function() {
                        timer = null;
                        $.event.trigger('exitintent');
                    }, $.exitIntent.settings.sensitivity);
            }

            function trackEnter() {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            }

            $.exitIntent = function(enable, options) {
                $.exitIntent.settings = $.extend($.exitIntent.settings, options);

                if (enable == 'enable') {
                    $(window).mouseleave(trackLeave);
                    $(window).mouseenter(trackEnter);
                } else if (enable == 'disable') {
trackEnter(); // Turn off any outstanding timer
$(window).unbind('mouseleave', trackLeave);
$(window).unbind('mouseenter', trackEnter);
} else {
    throw "Invalid parameter to jQuery.exitIntent -- should be 'enable'/'disable'";
}
}

$.exitIntent.settings = {
    'sensitivity': 50
};

})(jQuery);



// logic for custom intent

var popupHtml = "<style>.popupcontainer-spreadr {position:fixed;z-index:2147483647;left:0;top:0;height:100vh;width:100vw;background-color:rgba(0,0,0,0.7);}.popupinnercontainer-spreadr{animation:pushdown 0.8s;height:94vh;width:94vw;top:3vh;position:fixed;left:3vw;box-shadow:0px 2px 7px #999;border-radius:3px;background-color:#fff;overflow:auto;}.popupclose-spreadr {color:#999;float:right;z-index:2147483647;position:absolute;right:40px; padding:20px 30px;cursor:pointer;top:16px;}.contentwraper-spreadr {margin-top:35px;text-align:center;text-decoration:none;}.exitpopuplink-spreadr {text-decoration:none !important;display:block;}.exitpopuplink-spreadr:active,.exitpopuplink-spreadr:focus,.exitpopuplink-spreadr:hover{outline:0;border:none;-moz-outline-style:none;opacity:1;}.introtext-spreadr {color:#999;font-weight:400;font-size:22px;}.popupimg-spreadr {max-width:90%;max-height:300px;}.producttitlewrap-spreadr {margin-right:auto;margin-left:auto;width:fit-content;}.producttitle-spreadr {max-width:600px;margin:20px auto 30px;color:#000;font-weight:700;font-size:26px;}.amazonbutton-spreadr {padding:10px 20px;background-color:#00c0ff;color:#fff;text-decoration:none;border-radius:5px;font-weight:700;font-size:24px;}.amazonbutton-spreadr:hover{ box-shadow:0 0 0 0.3rem rgba(0,0,0,.05); opacity:0.95;}@keyframes pushdown {0% {opacity:0;transform:translateY(-2000px);}60% {opacity:1;transform:translateY(30px);}80% {transform:translateY(-10px);}100% {transform:translateY(0);}}</style><div id='spreadrExit' class='popupcontainer-spreadr'><div class='popupinnercontainer-spreadr'><div class='contentwraper-spreadr'><span id='exitSpreadr' class='popupclose-spreadr'>X</span><a href='https://www.amazon.com/Matador-Blanket-2-0-camping-Resistant/dp/B06VVVQ72B/' target='_blank' class='exitpopuplink-spreadr' id='exitpopuplink-spreadr'><div class='introtext-spreadr'>Before you leave...</div><br><img class='popupimg-spreadr' id='popupimg-spreadr' src='https://images-na.ssl-images-amazon.com/images/I/81ggWEkbIIL._SL1500_.jpg'><div class='producttitlewrap-spreadr'><div class='producttitle-spreadr' id='producttitle-spreadr'>Matador Ultra Compact Pocket Blanket</div></div><div><span class='amazonbutton-spreadr'>View on Amazon</span></div><br></a></div></div></div>";




$(function() {

        var products = 0;
        var asins = '';
        var appearance = '';
        var tags = '{"comtag":"simplex05-20","intag":"","catag":"","uktag":"","detag":"","frtag":"","estag":"","cntag":"","ittag":"","jptag":"","mxtag":"","brtag":"","autag":"","buttontext":"Get Deal","islocalizeon":0,"isganalyticson":0,"isfacebookpixel":0}';
        var isActive = '0';
        isActive = parseInt(isActive);
        if(isActive == 0){
            $.exitIntent('disable');
            return false;
        }

        let setting = '1';
        setting = parseInt(setting);
        let maxnumber = '10';
        maxnumber = parseInt(maxnumber);
        if(asins == ''){
            $.exitIntent('disable');
            return false;
        } else {
        let productObj = products;
        let asinObj = jQuery.parseJSON(asins);

        let selextIndex = getSelectIndex(asinObj.length);

        let selecteAsin = asinObj[selextIndex];
        let selectedProduct = productObj[selecteAsin];

        let appearanceObj = jQuery.parseJSON(appearance);
         let tagsObj = jQuery.parseJSON(tags);

        let popupcount = getSpreadrWidgetCookie('spreadrexit');
        if(popupcount == '' ){
            popupcount = 0;
        }
        popupcount = parseInt(popupcount);
         $('body').append(popupHtml);





        $('.introtext-spreadr').text(appearanceObj['introtext']);
        $('#producttitle-spreadr').text(selectedProduct['title']);
        $('#popupimg-spreadr').attr('src',selectedProduct['imageurl']);
         $('#exitpopuplink-spreadr').attr('href',selectedProduct['url']);
         //SetAffiliateTagsSpreadrWidget(region,asin = '',tags,spreadrRedirectURL = '')

         SetAffiliateTagsSpreadrWidget(selectedProduct['region'],selectedProduct['amazonid'],tagsObj);
         if(tagsObj['islocalizeon'] == 1 ) {
            SetGeoAffiliateTagsSpreadrWidget(selectedProduct['amazontitle'],tagsObj,selectedProduct);

         }

        //colors  //colorbackgroundtitlebuttonbackgroundbuttontext
         $('.popupinnercontainer-spreadr').css('background-color', appearanceObj['background']);
         $('.introtext-spreadr').css('color', appearanceObj['color']);

           $('.producttitle-spreadr').css('color', appearanceObj['title']);

            $('.amazonbutton-spreadr').css('background-color', appearanceObj['buttonbackground']);
            $('.amazonbutton-spreadr').css('color', appearanceObj['buttontext']);

                   $('.introtext-spreadr').css('font-size',appearanceObj['introsize']+'px');
        $('.producttitle-spreadr').css('font-size',appearanceObj['titlesize']+'px');
        $('.amazonbutton-spreadr').css('font-size',appearanceObj['buttonsize']+'px');

         $('.introtext-spreadr, .producttitle-spreadr, .amazonbutton-spreadr').css('font-family',appearanceObj['fonttype']);



        $('#spreadrExit').hide();

        $.exitIntent('enable');
        }
        $(document).bind('exitintent', function() {




            let popupcount = getSpreadrWidgetCookie('spreadrexit');
            if(popupcount == '' ){
                popupcount = 0;
            }
            popupcount = parseInt(popupcount);


             if(setting == 1){
               var   spreadrexit = parseInt(1);
           setSpreadrWidgetCookie('spreadrexit',spreadrexit, 1);
                  $('#spreadrExit').slideDown();

                   if(typeof ga !== 'undefined')
                 {
                   ga('send', 'event', { eventCategory: 'Spreadr', eventAction: 'Exit Popup View'});
                 }
            } else if(setting == 2 && maxnumber >= popupcount) {



                 exitpopcount();
                 $('#spreadrExit').slideDown();
                  if(typeof ga !== 'undefined')
                 {
                   ga('send', 'event', { eventCategory: 'Spreadr', eventAction: 'Exit Popup View'});
                 }
            }



        });
        $('#warning a').bind('click', function() {
            $('#spreadrExit').slideUp();
            return false;
        });
    });



    $(document).on('click','#exitSpreadr', function(){

         $('#spreadrExit').hide();
        $.exitIntent('disable');
        return false;

    });


}//endof spreadrCode



if (typeof jQuery == 'undefined') {

    var script = document.createElement('script');
    document.head.appendChild(script);
    script.type = 'text/javascript';
    script.src = '//ajax.googleapis.com/ajax/libs/jquery/3.1.0/jquery.min.js';

    script.onload = spreadrWidgetCode;

} else {

    spreadrWidgetCode();

}

function getSelectIndex(totalProducts) {

        var  oldproductindex = getSpreadrWidgetCookie('oldproductindex');

        if(oldproductindex != '') {
          oldproductindex = parseInt(oldproductindex)+1;
          if(totalProducts <= oldproductindex){
             oldproductindex = parseInt(0);
          }
           setSpreadrWidgetCookie('oldproductindex', oldproductindex, 1);
        } else {
           oldproductindex = parseInt(0);
           setSpreadrWidgetCookie('oldproductindex',oldproductindex, 1);
        }

        return oldproductindex;
}


function exitpopcount() {
        var  spreadrexit = getSpreadrWidgetCookie('spreadrexit');
        if(spreadrexit != '') {
          spreadrexit = parseInt(spreadrexit)+1;
           setSpreadrWidgetCookie('spreadrexit', spreadrexit, 1);
        } else {
           spreadrexit = parseInt(1);
           setSpreadrWidgetCookie('spreadrexit',spreadrexit, 1);
        }

        return spreadrexit;
}


function setSpreadrWidgetCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires="+d.toUTCString();
     let oldcookietime = getSpreadrWidgetCookie('spreadrexitexpiry');
    if(oldcookietime != '') {
      expires = getSpreadrWidgetCookie('spreadrexitexpiry');
    document.cookie = 'spreadrexitexpiry' + "=" + expires + ";" + expires + ";path=/";
   }

    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";


   if(oldcookietime == '') {
    document.cookie = 'spreadrexitexpiry' + "=" + expires + ";" + expires + ";path=/";
   }

}


function getSpreadrWidgetCookie(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for(var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return '';
}


function SetAffiliateTagsSpreadrWidget(region,asin,tags,spreadrRedirectURL)
{
    if(asin != ''){
         spreadrRedirectURL =  'http://amazon.' + region + '/dp/'+asin;
    }


    var region = region;

    var affiliateTag = '';
    if(region == 'com')
    {
        affiliateTag = tags['comtag'];
    }
    else if(region == 'in')
    {
        affiliateTag = tags['intag'];
    }
     else if(region == 'ca')
    {
        affiliateTag = tags['catag'];
    }
      else if(region == 'co.uk')
    {
        affiliateTag = tags['uktag'];
    }
     else if(region == 'de')
    {
        affiliateTag = tags['detag'];
    }
     else if(region == 'fr')
    {
        affiliateTag = tags['frtag'];
    }
     else if(region == 'es')
    {
        affiliateTag = tags['estag'];
    }
     else if(region == 'cn')
    {
        affiliateTag = tags['cntag'];
    }
     else if(region == 'it')
    {
        affiliateTag = tags['ittag'];
    }
     else if(region == 'co.jp')
    {
        affiliateTag = tags['jptag'];
    }
     else if(region == 'com.mx')
    {
        affiliateTag = tags['mxtag'];
    }
     else if(region == 'com.br')
    {
        affiliateTag = tags['brtag'];
    }
     else if(region == 'com.au')
    {
        affiliateTag = tags['autag'];
    }

    spreadrRedirectURL = spreadrRedirectURL+'?tag='+affiliateTag;
    $('#exitpopuplink-spreadr').attr('href',spreadrRedirectURL);
}


  $(document).on('click','#exitpopuplink-spreadr', function(){
        var link = $(this).attr('href');

        if(0)
        {
          //attach click event listener

                if(typeof ga !== 'undefined')
                 {
                   ga('send', 'event', { eventCategory: 'Spreadr', eventAction: 'Exit Popup Click', eventLabel: link});
                 }

        }


    });



function SetGeoAffiliateTagsSpreadrWidget(title,tagsObj,selectedProduct)
{
    var keywords = encodeURIComponent(title);

    jQuery.ajax({
        url: '//extreme-ip-lookup.com/json',
        type: 'POST',
        dataType: 'jsonp',
        success: function(location) {
            if(location.countryCode == undefined){
                 jQuery.ajax({
                    url: '//api.wipmania.com/json/',
                    type: 'POST',
                    dataType: 'jsonp',
                    success: function(location) {
                        if(selectedProduct['region'] != location.address.country_code.toLowerCase()) {
                        var spreadrRedirectURL = 'http://amazon.' + location.address.country_code.toLowerCase() + '/s/?field-keywords=' + keywords;
                        SetAffiliateTagsSpreadrWidget(location.address.country_code.toLowerCase(),'',tagsObj,spreadrRedirectURL);
                        }
                    }
                });
            } else {

                if(selectedProduct['region'] != location.countryCode.toLowerCase()) {

                  var spreadrRedirectURL = 'http://amazon.' + location.countryCode.toLowerCase() + '/s/?field-keywords=' + keywords;
                  SetAffiliateTagsSpreadrWidget(location.countryCode.toLowerCase(),'',tagsObj,spreadrRedirectURL);
                }






            }

        }
    });

}



