<%inherit file="base.mako"/>
<%namespace name="nav" file="nav.mako" />

<%block name="navigation">
${nav.nav('games')}
</%block>

<h1>HTTP 401 - Unauthorized</h1>

You need to <a href="/account/auth/steam?returnUrl=${requestUrl}">Sign in through STEAM</a> to access the desired page.