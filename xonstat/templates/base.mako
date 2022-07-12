<%namespace name="nav" file="nav.mako"/>

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>QLStats: Player Statistics for Quake Live</title>
    <meta name="description" content="">
    <meta name="author" content="">
    
    <!-- fonts.googleapis.com/css?family=Open+Sans&subset=latin,greek,cyrillic-ext,latin-ext,cyrillic -->
    <link href='/static/css/googlefonts.css' rel='stylesheet' type='text/css'>
    <link rel="shortcut icon" href="/static/favicon.ico?v=2">

    <%block name="css">
    <!-- maxcdn.bootstrapcdn.com/bootstrap/3.3.5/css/bootstrap.min.css -->
    <link href="/static/css/bootstrap.min.css" rel="stylesheet">

    <link href="/static/css/app.min.css" rel="stylesheet">
    </%block>

    <script>
      function setCookie(name, value, persistent) {
        if (value === null || value === undefined) {
          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/"
          return;
        }
        
        var cookie = name + "=" + value;
        if (persistent === undefined)
          persistent = document.cookie.match(/allowCookies=true/);
        if (persistent) {
          var exp = new Date(Date.now() + 30*24*60*60*1000);
          cookie += "; expires=" + exp.toUTCString();
        }
        cookie += "; path=/";
        document.cookie = cookie;
      }
      function getCookie(name) {
        var match = document.cookie.match(new RegExp(name + "=([^;]*)"));
        return match ? match[1] : null;
      }

      (function() {
        if (!document.cookie.match(/allowCookies=true/))
        {
          // remove old persistent cookies
          if (document.cookie.match(/region=\d/))
            document.cookie = "region=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
          if (document.cookie.match(/gametype=[a-z]*/))
            document.cookie = "gametype=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
          if (document.cookie.match(/weapons=[a-z]*/))
            document.cookie = "weapons=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
          if (document.cookie.match(/_ga=/))
            document.cookie = "_ga=; path=/; domain=.qlstats.net; expires=Thu, 01 Jan 1970 00:00:01 GMT";
          if (document.cookie.match(/_gat=/))
            document.cookie = "_gat=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";

          if (!location.href.match(/\/cookie/)) {
            location.href="/cookies?referer=" + encodeURIComponent(location.href);
          }
          return;
        }

        if (!document.cookie.match(/region=\d/))
          setCookie("region", "0");
        if (!document.cookie.match(/gametype=[a-z]*/))
          setCookie("gametype", "");
        if (!document.cookie.match(/weapons=[a-z]*/))
          setCookie("weapons", "mg,lg,rg,hmg");

        // Google Analytics (removed)
        
      })();
    </script>
  </head>

  <body>
    <%block name="navigation">
    ${nav.nav("leaderboard")}
    </%block>

    <div class="container-fluid" style="margin-left:15px;margin-right:15px;">
      <%block name="hero_unit">
      </%block>

      <div class="row">
        <div class="col-sm-12" id="xonborder">
          <div id="title"><%block name="title"></%block></div>
          ${self.body()}
        </div>
      </div>

      <%block name="footer">
      <div class="row shadowtext" id="pageFooter">
        <div class="col-sm-10 col-sm-offset-1">
          <p class="text-center">
            QLStats was created by PredatH0r as a Quake Live modification of <a href="http://stats.xonotic.org" target="_blank">XonStat</a>,
            the <a href="http://www.xonotic.org" target="_blank">Xonotic</a> stats tracking system created by Antibody.

            <br>Both are licensed under GPLv2 and available on Github: <a href="https://github.com/PredatH0r/xonstat" title="Go to the project page" target="_blank">QLStats</a>,
            <a href="https://github.com/antzucaro/XonStat" title="Go to the project page" target="_blank">XonStat</a>
            <br>Geo-IP information provided by <a href="http://www.freegeoip.net">freegeoip.net</a> | Flag images provided by <a href="http://www.icondrawer.com/flag-icons.php">icondrawer.com</a>
            <br><a href="/static/legal.html">Legal information</a> (contact, cookie policy, data privacy, disclaimer)
          </p>
        </div>
      </div>
      </%block>

    </div>

    <%block name="js">
    <!-- ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js' -->
    <script type='text/javascript' src='/static/js/jquery.min.js'></script>
    <!-- maxcdn.bootstrapcdn.com/bootstrap/3.3.5/js/bootstrap.min.js -->
    <script type='text/javascript' src='/static/js/bootstrap.min.js'></script>
    <script>
      var entityMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': '&quot;', "'": '&#39;', "/": '&#x2F;' };
      function escapeHtml(string) { return String(string).replace(/[&<>"'\/]/g, function (s) { return entityMap[s]; }); }
      function htmlColors(text) {
        text = escapeHtml(text);
        return "<span class='ql7'>" + text.replace(/\^[0-7]/g, function(match) { return "</span><span class='ql" + match[1] + "'>"; }) + "</span>";
      }

    </script>
    </%block>

    <script type="text/javascript">
      // RELATIVE TIME CONVERSION
      $('.abstime').each(function(i,e){
        var $e = $(e);
        var epoch = $e.attr('data-epoch');
        $e.attr("title", $e.text());
        $e.text(dateToString(epoch));
      });

      function dateToString(epoch) {
        if (!epoch || epoch === "None")
          return "-";
        var d = new Date(0);
        d.setUTCSeconds(epoch);
        var dt = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).toString().substr(-2) + "-" + ("0" + d.getDate()).substr(-2);
        var tm = ("0" + d.getHours()).toString().substr(-2) + ":" + ("0" + d.getMinutes()).toString().substr(-2) + ":" + ("0" + d.getSeconds()).toString().substr(-2);
        return Date.now()/1000 - parseInt(epoch) < 24*60*60 ? tm : dt + "   " + tm
      }
    </script>

  </body>
</html>
