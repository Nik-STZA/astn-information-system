-- Seed content_sources from AfricanSTN Source Registry Google Sheet
-- Generated: 30 July 2026
-- Source: Master Registry tab (265 sources)

INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://disruptafrica.com/feed', 'Disrupt Africa', 'tech_news', 'rss', 'en, fr', true, 'high', 'Pan-Africa', 'ASE, FD, GST', 'africa_brief, deal_tracker', 'Pan-African tech & startup news — strongest Africa signal', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://techcabal.com/feed', 'TechCabal', 'tech_news', 'rss', 'en', true, 'high', 'West Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Nigerian tech focus — strong editorial, ecosystem coverage', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://techpoint.africa/feed/', 'Techpoint Africa', 'tech_news', 'rss', 'en', true, 'high', 'West Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'Nigerian tech — startup funding & ecosystem news', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://techcrunch.com/tag/africa/feed', 'TechCrunch Africa', 'tech_news', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'African tech ecosystem — funding & deal coverage', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://ventureburn.com/feed/', 'Ventureburn', 'funding', 'rss', 'en', true, 'high', 'Southern Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'SA startup & VC news — strong deal signal', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.thebigdeal.substack.com/feed', 'The Big Deal Africa', 'funding', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'African startup funding tracker — deal data & analysis', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://restofworld.org/feed/latest', 'Rest of World', 'tech_news', 'rss', 'en', true, 'medium', 'Global South', 'ASE, GST', 'africa_brief, trend_analysis', 'Emerging market tech — good Africa stories', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.howwemadeitinafrica.com/feed/', 'How We Made It in Africa', 'business', 'rss', 'en', true, 'medium', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'African business success stories & investment', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://africa.businessinsider.com/feed', 'Business Insider Africa', 'business', 'rss', 'en', true, 'medium', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'African business & investment — VERIFY RSS path', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.cafonline.com/api/rss/news', 'CAF Online', 'sports_news', 'rss', 'en, fr', true, 'high', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'Confederation of African Football — continental authority', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.insideworldfootball.com/feed/', 'Inside World Football', 'sports_news', 'rss', 'en', true, 'high', 'Global', 'ASE, SBM', 'africa_brief, biz_intel', 'FIFA/CAF governance, media rights, African football politics', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.psl.co.za/rss', 'Premier Soccer League', 'sports_news', 'rss', 'en', true, 'high', 'Southern Africa', 'ASE', 'africa_brief', 'SA top football league — VERIFY RSS endpoint', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://bal.nba.com/news/rss', 'Basketball Africa League', 'sports_news', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'BAL news — key African league with tech/media investment', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.rugbyafrique.com/feed', 'Rugby Afrique', 'sports_news', 'rss', 'en, fr', true, 'high', 'Pan-Africa', 'ASE', 'africa_brief', 'African rugby federation — continental coverage', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://esportsafricanews.com/feed', 'Esports Africa News', 'sports_tech', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'African esports ecosystem coverage', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.businessofsportsafrica.com/latest-insights?format=rss&page=1', 'Business of Sports Africa', 'business', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'Africa sports business news — VERIFY RSS format', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.fifpro.org/en/news?format=rss', 'FIFPro', 'sports_news', 'rss', 'en', true, 'high', 'Global', 'ASE, SBM', 'africa_brief, biz_intel', 'Player data, athlete rights, global football policy', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.supersport.com/rss', 'SuperSport', 'sports_news', 'rss', 'en', true, 'high', 'Southern Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'Africa''s biggest sports broadcaster — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sporttechie.com/feed', 'SportTechie', 'sports_tech', 'rss', 'en', true, 'high', 'Global', 'GST, FD', 'trend_analysis, deal_tracker', 'Daily sports tech news — broadest sector coverage', 'investor_tracker, tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportspro.com/feed', 'SportsPro', 'sports_tech', 'rss', 'en', true, 'high', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Sports media, tech strategy — strong editorial quality', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://techcrunch.com/tag/sports/feed', 'TechCrunch Sports', 'sports_tech', 'rss', 'en', true, 'high', 'Global', 'GST, FD', 'trend_analysis, deal_tracker', 'Sports startup funding & deal news', 'investor_tracker, tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://tech.sportbusiness.com/feed', 'SportBusiness Tech', 'sports_tech', 'rss', 'en', true, 'high', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Deep sports tech analysis — subset of SportBusiness', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsbusinessjournal.com/Technology/RSS', 'SBJ Tech', 'sports_tech', 'rss', 'en', true, 'high', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Enterprise sports tech & deals — VERIFY RSS access', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://newsletter.sportstechx.com/feed', 'SportsTechX Newsletter', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Weekly sports tech funding & VC dealflow — VERIFY post-shutdown', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.thefourthquarter.co/feed', 'The Fourth Quarter', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'VC and startup insights in sports', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://hillside.substack.com/feed', 'Hillside Sports Tech', 'analysis', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'M&A and IPO analysis in sports tech', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.gsic.global/feed/', 'GSIC', 'sports_tech', 'rss', 'en, es', true, 'high', 'Global', 'GST, ASE', 'trend_analysis, africa_brief', 'Microsoft-backed sports innovation center', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstechworld.de/feed/', 'Sports Tech World', 'sports_tech', 'rss', 'en, de', true, 'medium', 'Europe', 'GST', 'trend_analysis', 'European sports tech — events & startups', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.geekwire.com/tag/sports-tech/feed', 'GeekWire Sports Tech', 'tech_news', 'rss', 'en', true, 'medium', 'North America', 'GST', 'trend_analysis', 'Tech industry crossover into sports', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://frontofficesports.com/feed', 'Front Office Sports', 'business', 'rss', 'en', true, 'high', 'Global', 'SBM, FD', 'biz_intel, deal_tracker', 'Sports business innovation, deals, media rights', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportbusiness.com/feed', 'SportBusiness', 'business', 'rss', 'en', true, 'high', 'Global', 'SBM, FD', 'biz_intel, deal_tracker', 'Global sports industry — M&A, rights, governance', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportcal.com/rss/', 'Sportcal', 'business', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Sports market data, event economics — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.globaldata.com/sports/feed/', 'GlobalData Sport', 'business', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Sports industry data & sponsorship — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://thesportslens.com/feed/', 'The Sports Lens', 'sports_news', 'rss', 'en', true, 'medium', 'Global', 'SBM, GST', 'biz_intel, trend_analysis', 'Sports analysis with tech crossover', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportingnews.com/rss', 'Sporting News', 'sports_news', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Mainstream sports news — context for intelligence — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.fifa.com/rss', 'FIFA News', 'sports_news', 'rss', 'en, fr, es', true, 'high', 'Global', 'SBM, ASE', 'biz_intel, africa_brief', 'World football governance — VERIFY RSS endpoint', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://olympics.com/ioc/news/rss', 'IOC News', 'sports_news', 'rss', 'en, fr', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Olympic governance, host cities, tech — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://news.crunchbase.com/feed/', 'Crunchbase News', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD', 'deal_tracker', 'Global startup funding data & deal analysis', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://pitchbook.com/blog/feed', 'PitchBook Blog', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD', 'deal_tracker', 'VC/PE deal data, valuations, exit analysis', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sifted.eu/feed', 'Sifted', 'funding', 'rss', 'en', true, 'high', 'Europe', 'FD', 'deal_tracker', 'European VC & startup funding — good Africa overlap', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://about.dealroom.co/blog/feed', 'Dealroom Blog', 'funding', 'rss', 'en', true, 'medium', 'Europe', 'FD', 'deal_tracker', 'European & global deal intelligence', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.reuters.com/technology/rss', 'Reuters Tech', 'business', 'rss', 'en', true, 'medium', 'Global', 'FD, SBM', 'deal_tracker, biz_intel', 'Global tech/business deals — authoritative wire', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.axios.com/pro-rata/feed', 'Axios Pro Rata', 'funding', 'rss', 'en', true, 'medium', 'North America', 'FD', 'deal_tracker', 'Daily VC deal flow insights', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://medium.com/feed/@adv_sporttech', 'ADvantage VC Blog', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Sports-focused VC — direct investment thesis & portfolio', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://51ventures.medium.com/feed', '51 Ventures Blog', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Sports tech VC — deal analysis & sector insights', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://pareto-economics.com/feed/', 'Pareto Economics', 'analysis', 'rss', 'en', true, 'medium', 'Global', 'FD, SBM', 'deal_tracker, biz_intel', 'Macro economic analysis relevant to sports investment — VERIFY RSS', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.statsperform.com/feed', 'Stats Perform', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'AI and sports data analytics — industry leader', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.geniussports.com/feed', 'Genius Sports', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Fan engagement and data technology — publicly traded', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://blog.catapultsports.com/feed/', 'Catapult Sports Blog', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Athlete tracking leader — acquired Impect (STX M&A data 2025)', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://blog.secondspectrum.com/feed/', 'Second Spectrum', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'AI-powered sports analytics — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportradar.com/news/feed/', 'Sportradar', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Sports data & integrity — publicly traded — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.hudl.com/blog/feed', 'Hudl Blog', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Video analysis & coaching platform — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://blog.playmaker.fans/feed/', 'Playmaker Blog', 'data', 'rss', 'en', true, 'medium', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Sports digital media analytics — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.scienceforsport.com/feed', 'Science for Sport', 'performance', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Performance science and analytics research', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://simplifaster.com/feed', 'SimpliFaster', 'performance', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Training, biomechanics, and speed tech', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.strengthandconditioning.org/feed', 'NSCA Blog', 'performance', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Strength & conditioning science — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.dazn.com/en-US/news/feed', 'DAZN News', 'business', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Sports streaming platform — $587M raise per STX dealflow — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://blog.teamworks.com/feed', 'Teamworks Blog', 'sports_tech', 'rss', 'en', true, 'medium', 'North America', 'GST', 'trend_analysis', '$235M Series F per STX dealflow — team ops tech — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://pixellot.tv/blog/feed/', 'Pixellot Blog', 'sports_tech', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'AI-automated sports production — $20M debt per STX — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.whoop.com/thelocker/feed/', 'WHOOP Blog', 'performance', 'rss', 'en', true, 'medium', 'North America', 'GST', 'trend_analysis', 'Wearable performance platform — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.premierleague.com/rss', 'Premier League', 'sports_news', 'rss', 'en', true, 'medium', 'Europe', 'SBM', 'biz_intel', 'EPL news — media rights benchmark — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.laliga.com/rss', 'LaLiga', 'sports_news', 'rss', 'en, es', true, 'medium', 'Europe', 'SBM, GST', 'biz_intel, trend_analysis', 'LaLiga tech innovation program — VERIFY RSS', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.worldathletics.org/rss', 'World Athletics', 'sports_news', 'rss', 'en', true, 'medium', 'Global', 'SBM, ASE', 'biz_intel, africa_brief', 'Global athletics — strong African presence — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.icc-cricket.com/rss', 'ICC Cricket', 'sports_news', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Cricket governance & media rights — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.thestadiumbusiness.com/feed/', 'The Stadium Business', 'business', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Venue tech, infrastructure, smart stadiums', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.coliseum-online.com/feed/', 'Coliseum', 'business', 'rss', 'en', true, 'medium', 'Global', 'SBM', 'biz_intel', 'Stadium & venue industry news — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://esportsinsider.com/feed', 'Esports Insider', 'sports_tech', 'rss', 'en', true, 'medium', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Esports business — deals, leagues, platforms', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.gamesindustry.biz/feed/news.rss', 'GamesIndustry.biz', 'sports_tech', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Gaming industry — esports/sports crossover', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://a16z.com/feed/', 'a16z Blog', 'analysis', 'rss', 'en', true, 'medium', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Top VC thought leadership — occasional sports/fitness', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.nfx.com/post/feed', 'NFX Blog', 'analysis', 'rss', 'en', true, 'medium', 'Global', 'FD', 'deal_tracker', 'Network effects VC — relevant to sports platforms — VERIFY RSS', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.iol.co.za/sport/rss', 'IOL Sport', 'sports_news', 'rss', 'en', true, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'SA sports news — broad coverage — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.goal.com/en-za/feeds/rss', 'Goal.com South Africa', 'sports_news', 'rss', 'en', true, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'SA football coverage — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.africanews.com/sport/rss', 'Africanews Sport', 'sports_news', 'rss', 'en, fr', true, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'Pan-African sports coverage — Euronews affiliate — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.bbc.co.uk/sport/africa/rss.xml', 'BBC Sport Africa', 'sports_news', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, SBM', 'africa_brief, biz_intel', 'Most reliable African sports journalism — verified RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.theguardian.com/football/africannationscup/rss', 'Guardian Africa Football', 'sports_news', 'rss', 'en', true, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'AFCON & African football — verified RSS format', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.advantage.vc/blog/feed', 'ADvantage SportsTech Fund', 'funding', 'rss', 'en', true, 'high', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Sports-focused early-stage VC from Israel — VERIFY RSS', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://accelerateventures.co.uk/blog/feed', 'Accelerate Ventures', 'funding', 'rss', 'en', true, 'medium', 'Europe', 'FD', 'deal_tracker', 'London-based sports & tech VC — VERIFY RSS', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.chiliz.com/blog/feed/', 'Chiliz Blog', 'sports_tech', 'rss', 'en', true, 'medium', 'Global', 'GST, FD', 'trend_analysis, deal_tracker', 'Fan tokens, Web3 sports — from STX ecosystem — VERIFY RSS', 'investor_tracker, tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.brila.net/feed/', 'Brila FM', 'sports_news', 'rss', 'en', true, 'medium', 'West Africa', 'ASE', 'africa_brief', 'Nigerian sports radio/media — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://completesports.com/feed/', 'Complete Sports', 'sports_news', 'rss', 'en', true, 'medium', 'West Africa', 'ASE', 'africa_brief', 'Nigerian sports news — football focused', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.capitalfm.co.ke/sports/feed/', 'Capital FM Sport Kenya', 'sports_news', 'rss', 'en', true, 'medium', 'East Africa', 'ASE', 'africa_brief', 'Kenyan sports news — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.the-star.co.ke/sports/rss', 'The Star Kenya Sports', 'sports_news', 'rss', 'en', true, 'medium', 'East Africa', 'ASE', 'africa_brief', 'Kenyan sports journalism — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.filgoal.com/rss', 'FilGoal', 'sports_news', 'rss', 'ar, en', true, 'medium', 'North Africa', 'ASE', 'africa_brief', 'Egyptian football — largest Arab sports site — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.le360sport.ma/feed/', 'Le360 Sport', 'sports_news', 'rss', 'fr, ar', true, 'medium', 'North Africa', 'ASE', 'africa_brief', 'Moroccan sports news — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.afrik-foot.com/feed', 'Afrik-Foot', 'sports_news', 'rss', 'fr', true, 'medium', 'Francophone Africa', 'ASE', 'africa_brief', 'Francophone African football coverage', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.africatopsports.com/feed/', 'Africa Top Sports', 'sports_news', 'rss', 'fr', true, 'medium', 'Francophone Africa', 'ASE', 'africa_brief', 'Pan-African sports in French — VERIFY RSS', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://blog.ballardchalmers.com/feed/', 'Ballard Chalmers', 'sports_tech', 'rss', 'en', true, 'medium', 'Europe', 'GST', 'trend_analysis', 'Sports tech consultancy insights — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsilab.com/blog/feed', 'Sports iLab', 'sports_tech', 'rss', 'en', true, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports innovation lab — research & analysis — VERIFY RSS', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportsinnovationlab.com/feed/', 'Sports Innovation Lab', 'analysis', 'rss', 'en', true, 'high', 'Global', 'GST, SBM', 'trend_analysis, biz_intel', 'Data-driven sports industry research — fan intelligence', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.weetrack.co/blog/feed', 'WeeTracker', 'funding', 'rss', 'en', true, 'medium', 'Pan-Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'African startup ecosystem & funding news — VERIFY RSS', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.digest.africa/feed', 'Digest Africa', 'funding', 'rss', 'en', true, 'high', 'Pan-Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'African startup data & funding intelligence — VERIFY RSS', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://futureofsport.co.za/feed/', 'Future of Sport SA', 'sports_tech', 'rss', 'en', true, 'medium', 'Southern Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'SA sports innovation conference & ecosystem — VERIFY RSS', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://afrikaworld.co.za/', 'Afrika World (ZA)', 'non_sports', 'website', 'fr', false, 'low', 'Southern Africa', '-', '-', 'NOT SPORTS — French-language cultural/religious site about Madagascar. Review for removal.', '')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportygroup.com/', 'Sporty Group', 'sports_media', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Global sports media & betting group — SportyBet, SportyTV strong in Nigeria/Ghana', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://africansci.com/', 'African Sports & Creative Institute (ASCI)', 'sports_business', 'website', 'en, fr', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Nonprofit — research, advisory, advocacy for African sports ecosystem development', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('asunified.com', 'Africa Sports Unified (ASU)', 'sports_business', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Knowledge platform, podcast & strategic partner — pan-African sports market insights', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://gis.sport/', 'Global Institute of Sport (GIS)', 'sports_education', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports management Master''s degrees — campuses at Wembley, Melbourne, Brussels, online', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://spnafricanews.com/', 'Sports Network Africa', 'sports_media', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Pan-African sports news & streaming — football, rugby, athletics, basketball coverage', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('africaninsider.com', 'African Insider', 'news', 'website', 'en', false, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'South African news outlet — general news with sports section', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportbusiness.com/geography/africa/', 'SportBusiness Africa', 'sports_business', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Leading sports industry intelligence — Africa-specific coverage of deals, rights & media', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.africanleadershipmagazine.co.uk/', 'African Leadership Magazine', 'business_media', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'Pan-African leadership & business magazine — occasional sports business coverage', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportian.com/', 'Sportian', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports technology & innovation platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsai.au/', 'Sports AI', 'sports_tech', 'website', 'en', false, 'medium', 'APAC', 'GST', 'trend_analysis', 'Australian AI-driven sports analytics platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.ventures54.com/', 'Ventures 54', 'investment', 'website', 'en', false, 'medium', 'Pan-Africa', 'FD, ASE', 'deal_tracker', 'African tech/startup ecosystem builder — UK-Africa investment corridor facilitator', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://batfast.com/', 'Batfast', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Cricket batting simulator technology company', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsfirst.net/', 'Sports First', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports industry consultancy & advisory', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.havaic.com/', 'HAVAÍC', 'investment', 'website', 'en', false, 'high', 'Southern Africa', 'FD, ASE', 'deal_tracker', 'Cape Town VC — early-stage African tech startups incl Sportable (sports data)', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.athletics.app/', 'Athletics App', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Athletics/track & field digital platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.joinplaymakers.co/', 'Playmakers', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports industry community & networking platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.kironinteractive.com/', 'Kiron Interactive', 'sports_tech', 'website', 'en', false, 'medium', 'Pan-Africa', 'GST', 'trend_analysis', 'Fantasy sports & esports platform — African market presence', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://startupkenya.io/', 'Startup Kenya', 'tech_ecosystem', 'website', 'en', false, 'medium', 'East Africa', 'ASE, FD', 'deal_tracker', 'Kenyan startup ecosystem portal — tech & innovation focus', 'ecosystem_programs, investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://universalspeedrating.com/', 'Universal Speed Rating', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Speed performance analytics & rating system', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://asbglassfloor.com/', 'ASB GlassFloor', 'sports_tech', 'website', 'en, de', false, 'low', 'Europe', 'GST', 'trend_analysis', 'LED glass sports flooring technology — basketball, squash, events', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://hitzcricket.com/', 'Hitz Cricket', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Cricket technology & training platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://turf.coach/', 'Turf Coach', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI-powered turf management & pitch care technology', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://learning.coachesvoice.com/', 'The Coaches'' Voice', 'sports_education', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Football coaching education & content platform', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.headcheckhealth.com/', 'HeadCheck Health', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Concussion & brain health assessment technology for sports', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://geminisports.ai/', 'Gemini Sports Analytics', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'AI-driven sports analytics & performance platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://oliversports.ai/', 'Oliver Sports AI', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'AI sports technology company', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://respo.vision/', 'Respo.Vision', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Computer vision sports analytics — tracking & performance data', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.playhq.com/uk/', 'PlayHQ', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Community sports management platform — registrations, fixtures, results', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsreels.org/', 'SportsReels', 'sports_media', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE, GST', 'africa_brief', 'African sports video/content platform', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportsafrica.org/partners/', 'Sports Africa', 'sports_development', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Sports development organization — partnerships for African sports ecosystem', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://africaneconomyinc.com/', 'African Economy Inc', 'business_media', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'Pan-African economic news & analysis platform', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.otbafrica.com/', 'OTB Africa', 'sports_business', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE, GST', 'africa_brief', 'Off The Ball Africa — sports business content & consulting', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.gbeexperthub.com/', 'GBE Expert Hub', 'business_consulting', 'website', 'en', false, 'low', 'Pan-Africa', 'ASE', 'africa_brief', 'Business consulting hub — pan-African focus', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://wfsgi.org/', 'World Federation of the Sporting Goods Industry', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Global sporting goods industry body — policy, standards, trade', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://backsports.co.za/', 'Back Sports', 'sports_media', 'website', 'en', false, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'South African sports news & content platform', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://au.int/', 'African Union', 'governance', 'website', 'en, fr, ar, pt', false, 'high', 'Pan-Africa', 'ASE', 'africa_brief', 'Continental body — sports policy, Youth Bureau, African Games governance', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportinnovator.nl/english/', 'Sport Innovator (Netherlands)', 'sports_tech', 'website', 'en, nl', false, 'medium', 'Europe', 'GST', 'trend_analysis', 'Dutch national sports innovation network — R&D, knowledge transfer', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.wolfcycle.ai/', 'WolfCycle AI', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI-powered cycling analytics & performance platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.tmrwsportsgroup.com/', 'TMRW Sports Group', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports venture group — golf (TGL) & next-gen sports experiences', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.recentiveanalytics.com/', 'Recentive Analytics', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI-powered event & venue scheduling optimization', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.owl.ai/', 'Owl AI', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI computer vision platform — safety & analytics applications', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.orreco.ai/', 'Orreco', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'AI-driven athlete biomarker analytics & injury prevention', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.mashgin.com/', 'Mashgin', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI self-checkout — stadium & venue concessions technology', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.bolt6.ai/', 'Bolt6', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI sports performance & sprint analytics technology', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://globalsportsdataandtechnologygroup.co.uk/', 'Global Sports Data & Technology Group', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'UK-based sports data consortium — standards & innovation', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportsinnovation.de/', 'Sports Innovation (Germany)', 'sports_tech', 'website', 'en, de', false, 'medium', 'Europe', 'GST', 'trend_analysis', 'German sports innovation platform — events, startups, ecosystem', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.quanta-i.com/', 'Quanta-i', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Quantitative intelligence & data analytics for sports', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportforlife.ca/', 'Sport for Life (Canada)', 'sports_development', 'website', 'en, fr', false, 'low', 'North America', 'GST', 'trend_analysis', 'Canadian sport development framework — physical literacy & LTAD', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://about.macron.com/en/', 'Macron', 'sports_apparel', 'website', 'en, it', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Italian technical sportswear brand — kit supplier for African federations', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.ssisa.com/', 'Sports Science Institute of South Africa (SSISA)', 'sports_science', 'website', 'en', false, 'high', 'Southern Africa', 'GST, ASE', 'trend_analysis, africa_brief', 'Leading African sports science research & performance institute', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://globalsportgroup.com/', 'Global Sport Group', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports consultancy — strategy, events, commercial advisory', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.propeaq.com/', 'Propeaq', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Light therapy glasses — jet lag & circadian rhythm for athletes', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.oneplan.io/', 'OnePlan', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Event & venue planning platform — mapping, operations, safety', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.psasquashtour.com/', 'PSA World Tour (Squash)', 'sports_federation', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Professional Squash Association — African player development pipeline', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.lboro.ac.uk/sport/', 'Loughborough University Sport', 'sports_education', 'website', 'en', false, 'medium', 'Europe', 'GST', 'trend_analysis', 'World-leading sports university — research, performance, innovation', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.asoif.com/', 'ASOIF', 'sports_federation', 'website', 'en, fr', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Assoc of Summer Olympic International Federations — governance & policy', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.lawinsport.com/', 'LawInSport', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports law news, analysis & education platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.commonwealthsport.com/', 'Commonwealth Sport', 'sports_federation', 'website', 'en', false, 'medium', 'Global', 'ASE, GST', 'africa_brief, trend_analysis', 'Commonwealth Games Federation — many African member nations', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.womeninsport.org/', 'Women in Sport', 'sports_development', 'website', 'en', false, 'medium', 'Global', 'GST, ASE', 'trend_analysis, africa_brief', 'UK charity — gender equality in sport, research & advocacy', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.workinsports.com/', 'Work in Sports', 'sports_careers', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Sports industry job board & career platform', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.premiersportsnetwork.com/', 'Premier Sports Network', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports business networking & consulting platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://silverbacks.holdings/', 'Silverbacks Holdings', 'investment', 'website', 'en', false, 'high', 'Pan-Africa', 'FD, ASE, GST', 'deal_tracker, africa_brief', 'Mauritius-based PE firm — African sports, tech, entertainment investments (AWFC, Cape Town Tigers)', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.africagcc-council.com/', 'Africa-GCC Council', 'business_consulting', 'website', 'en, ar', false, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'Africa-Gulf Cooperation Council — trade, investment & diplomatic relations', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstechedu.org/', 'SportsTech Edu', 'sports_education', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports technology education & certification platform', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://premierinvest.com/', 'Premier Invest', 'investment', 'website', 'en', false, 'low', 'Global', 'FD', 'deal_tracker', 'Investment advisory & asset management', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sa20.co.za/', 'SA20 Cricket League', 'sports_league', 'website', 'en', false, 'high', 'Southern Africa', 'ASE, GST', 'africa_brief', 'South Africa''s premier T20 cricket franchise league', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportgensummit.com/', 'SportGen Summit', 'sports_business', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Sports industry conference/summit — African sports ecosystem', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.sportbusiness.com/', 'SportBusiness', 'sports_business', 'website', 'en', false, 'high', 'Global', 'GST', 'trend_analysis', 'Global sports industry intelligence — media rights, sponsorship, analytics', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.nswis.com.au/', 'NSW Institute of Sport', 'sports_science', 'website', 'en', false, 'low', 'APAC', 'GST', 'trend_analysis', 'Australian high-performance sport institute — athlete development', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.underarmour.com/', 'Under Armour', 'sports_apparel', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Global sports apparel & performance brand', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportscap.co.za/', 'SportsCap', 'investment', 'website', 'en', false, 'high', 'Southern Africa', 'FD, ASE', 'deal_tracker, africa_brief', 'South African sports investment & advisory firm', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.videoanalysisafrica.com/', 'Video Analysis Africa', 'sports_tech', 'website', 'en', false, 'high', 'Pan-Africa', 'GST, ASE', 'trend_analysis, africa_brief', 'Video analytics specifically for African sports — performance & coaching', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportinnovationalliance.com/', 'Sport Innovation Alliance', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Global sports innovation network — connecting startups & industry', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.sportboost.es/', 'SportBoost', 'investment', 'website', 'en, es', false, 'medium', 'Europe', 'GST, FD', 'trend_analysis, deal_tracker', 'Spanish sports tech accelerator & venture fund', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.spsgconsulting.com/', 'SPSG Consulting', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports & entertainment strategy consultancy', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://thehumanoid.ai/', 'The Humanoid AI', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'AI humanoid robotics — potential sports/performance applications', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.aerobotics.com/', 'Aerobotics', 'agri_tech', 'website', 'en', false, 'low', 'Southern Africa', 'ASE', 'africa_brief', 'South African drone/AI agri-tech — adjacent to sports turf/field management', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.spobis.com/', 'SPOBIS', 'sports_business', 'website', 'en, de', false, 'medium', 'Europe', 'GST', 'trend_analysis', 'Europe''s leading sports business summit & conference', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.pe-insights.com/', 'PE Insights', 'investment', 'website', 'en', false, 'medium', 'Global', 'FD', 'deal_tracker', 'Private equity industry news & analysis', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.nergii.com/', 'NERGii', 'sports_tech', 'website', 'en', false, 'high', 'Southern Africa', 'GST, ASE', 'trend_analysis, africa_brief', 'South African sports nutrition/hydration tech — Silverbacks portfolio company', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.africanwarriorsfc.com/', 'African Warriors Fighting Championship (AWFC)', 'sports_league', 'website', 'en', false, 'high', 'West Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Nigeria''s largest Dambe boxing promoter — African combat sports platform', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sports20.org/', 'Sports 2.0', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports technology & innovation thought leadership platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.ion54.com/', 'ION 54', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Unified golf development & management platform by 54 Group — events, agronomy, advisory', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.pivotalpartners.io/', 'Pivotal Partners', 'investment', 'website', 'en', false, 'medium', 'Pan-Africa', 'FD', 'deal_tracker', 'Africa-focused investment & advisory firm', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sbcafritech.com/', 'SBC AfriTech', 'sports_business', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Sports betting & gaming conference — African tech & business focus', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportera.org/', 'Sportera', 'sports_development', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports for social development platform — projects & impact', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.weartechclub.com/', 'WearTech Club', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Wearable technology community — sports & health devices', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstechjapan.com/', 'SportsTech Japan', 'sports_tech', 'website', 'en, ja', false, 'low', 'APAC', 'GST', 'trend_analysis', 'Japanese sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.nordicsportstech.com/', 'Nordic Sports Tech', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Nordic region sports technology network', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstechchile.cl/', 'SportsTech Chile', 'sports_tech', 'website', 'en, es', false, 'low', 'LATAM', 'GST', 'trend_analysis', 'Chilean sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.techbelgium.be/sports-entertainment', 'TechBelgium Sports', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Belgian tech hub — sports & entertainment vertical', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://brazilsports.tech/', 'Brazil Sports Tech', 'sports_tech', 'website', 'en, pt', false, 'low', 'LATAM', 'GST', 'trend_analysis', 'Brazilian sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportstechaustria.com/', 'SportsTech Austria', 'sports_tech', 'website', 'en, de', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Austrian sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sporttechlatvia.lv/', 'SportTech Latvia', 'sports_tech', 'website', 'en, lv', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Latvian sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://qatarsportstech.com/', 'Qatar Sports Tech', 'sports_tech', 'website', 'en, ar', false, 'medium', 'MENA', 'GST', 'trend_analysis', 'Qatari sports technology hub — post-World Cup innovation ecosystem', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstechscotland.com/', 'SportsTech Scotland', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Scottish sports technology network & innovation hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://istassociation.com/', 'International Sports Technology Association (ISTA)', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Global sports technology industry body — standards & networking', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://olympics.com/ioc', 'International Olympic Committee (IOC)', 'sports_federation', 'website', 'en, fr', false, 'high', 'Global', 'GST, ASE', 'trend_analysis, africa_brief', 'Olympic movement governance — African athlete development & continental games', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.hexagoncup.com/', 'Hexagon Cup', 'sports_league', 'website', 'en, es', false, 'low', 'Global', 'GST', 'trend_analysis', 'Mixed-gender padel competition — innovative sports format', 'governance_policy')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://esportsworldcup.com/', 'Esports World Cup', 'esports', 'website', 'en, ar', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Major global esports competition — Saudi-hosted, growing African participation', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://staarsports.com/', 'STAAR Sports', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports data, analytics & technology company', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.techinafrica.com/', 'Tech in Africa', 'tech_news', 'website', 'en', false, 'medium', 'Pan-Africa', 'ASE', 'africa_brief', 'African technology news & startup ecosystem coverage', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sasportspress.co.za/', 'SA Sports Press', 'sports_media', 'website', 'en', false, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'South African sports journalism & media organization', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.proitupoptics.com/', 'Proitup Optics', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Optics/vision technology for sports performance', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.globalesports.org/news', 'Global Esports Federation', 'esports', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'International esports governing body — African esports development', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportsingularity.com/', 'Sport Singularity', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Sports technology convergence & innovation platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportstechsweden.com/', 'SportsTech Sweden', 'sports_tech', 'website', 'en, sv', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Swedish sports technology network & ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.apex-cp.com/', 'Apex CP', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Sports technology & consulting firm', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.norwegiansporttech.com/', 'Norwegian Sport Tech', 'sports_tech', 'website', 'en, no', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Norwegian sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportstechturkey.com/', 'SportsTech Turkey', 'sports_tech', 'website', 'en, tr', false, 'low', 'MENA', 'GST', 'trend_analysis', 'Turkish sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://rugbyconnector.com/', 'Rugby Connector', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Rugby networking & management platform — connects players, clubs, agents', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportzinteractive.net/', 'Sportz Interactive', 'sports_tech', 'website', 'en', false, 'medium', 'APAC', 'GST', 'trend_analysis', 'Indian sports tech — digital fan engagement, data, content management', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://magnifi.ai/', 'Magnifi AI', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'AI-powered sports video highlights & content automation', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.twelvelabs.io/', 'Twelve Labs', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'AI video understanding platform — sports video analysis applications', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.backpagesport.co.uk/', 'Back Page Sport', 'sports_media', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'UK sports journalism & media platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://supersportschools.com/', 'SuperSport Schools', 'sports_development', 'website', 'en', false, 'high', 'Southern Africa', 'ASE, GST', 'africa_brief', 'MultiChoice SuperSport schools programme — youth sports development in Africa', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://aisport.africa/', 'AI Sport Africa', 'sports_tech', 'website', 'en', false, 'high', 'Pan-Africa', 'GST, ASE', 'trend_analysis, africa_brief', 'AI-powered sports platform specifically for African market', 'tech_landscape, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://aeciworld.com/', 'AECI World', 'chemical_industrial', 'website', 'en', false, 'low', 'Southern Africa', 'ASE', 'africa_brief', 'South African chemicals/industrial group — potential sports infrastructure/materials', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.hawkindynamics.com/', 'Hawkin Dynamics', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Force plate & athlete testing technology — strength & conditioning', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.vald.com/', 'VALD Performance', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Human measurement & sports performance technology — NordBord, ForceDecks', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://wsc-sports.com/', 'WSC Sports', 'sports_tech', 'website', 'en', false, 'high', 'Global', 'GST', 'trend_analysis', 'AI sports video highlights platform — automated content creation for leagues/broadcasters', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.outputsports.com/', 'Output Sports', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Wearable athlete monitoring & performance assessment platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://kitmanlabs.com/', 'Kitman Labs', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports intelligence platform — injury prevention, performance optimization', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.statsbomb.com/', 'StatsBomb', 'sports_tech', 'website', 'en', false, 'high', 'Global', 'GST', 'trend_analysis', 'Advanced football analytics & data provider — used by top leagues worldwide', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportvot.com/', 'SportVot', 'sports_tech', 'website', 'en', false, 'medium', 'APAC', 'GST', 'trend_analysis', 'AI-powered sports broadcasting & streaming for grassroots/emerging leagues', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.hudl.com/jobs', 'Hudl', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Video analysis & performance platform — coaching tools for teams at all levels', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.valdperformance.com/', 'VALD Performance (alt)', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Duplicate/alt domain — see vald.com entry for athlete measurement tech', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.fanaticsinc.com/', 'Fanatics', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Global sports merchandising & e-commerce platform — licensed products', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.genletics.co.uk/access', 'Genletics', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Genetics-based sports talent identification & personalized training', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.roguefitness.com/', 'Rogue Fitness', 'sports_equipment', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Premium strength & conditioning equipment manufacturer', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.uefa.com/', 'UEFA', 'sports_federation', 'website', 'en, fr', false, 'medium', 'Europe', 'GST', 'trend_analysis', 'European football body — African talent pipeline, development programs', 'governance_policy')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://fifaworldcup.com/', 'FIFA World Cup', 'sports_federation', 'website', 'en, fr, es', false, 'high', 'Global', 'GST, ASE', 'trend_analysis, africa_brief', 'FIFA — 2030 World Cup includes Morocco (Africa), global football governance', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://hyrox.com/', 'HYROX', 'sports_league', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Fitness racing competition — hybrid workout/race events expanding globally', 'governance_policy')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.blkboxfitness.com/', 'BLK BOX Fitness', 'sports_equipment', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Functional fitness equipment manufacturer', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.itftennis.com/', 'International Tennis Federation (ITF)', 'sports_federation', 'website', 'en', false, 'medium', 'Global', 'GST, ASE', 'trend_analysis, africa_brief', 'Tennis governing body — African tennis development programs', 'governance_policy, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.startup365.fr/investors-database/', 'Startup365 Investors Database', 'investment', 'website', 'en, fr', false, 'low', 'Europe', 'FD', 'deal_tracker', 'French startup/investor directory platform', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.sportstechpoland.com/', 'SportsTech Poland', 'sports_tech', 'website', 'en, pl', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Polish sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://sportstechireland.com/', 'SportsTech Ireland', 'sports_tech', 'website', 'en', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Irish sports technology network & innovation hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.worldfencingleague.org/', 'World Fencing League', 'sports_league', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Professional fencing league — emerging global sports property', 'governance_policy')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.ispo.com/', 'ISPO', 'sports_business', 'website', 'en, de', false, 'medium', 'Global', 'GST', 'trend_analysis', 'World''s largest sports business trade show — Munich, innovation awards', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.thesportsconsultancy.com/', 'The Sports Consultancy', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Global sports strategy & management consultancy', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.scienceforsport.com/', 'Science for Sport', 'sports_science', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports science education & research platform — coaching & S&C', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.polarcool.se/', 'PolarCool', 'sports_tech', 'website', 'en, sv', false, 'low', 'Europe', 'GST', 'trend_analysis', 'Swedish medtech — brain cooling technology for concussion treatment in sport', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportstechatlanta.com/', 'SportsTech Atlanta', 'sports_tech', 'website', 'en', false, 'low', 'North America', 'GST', 'trend_analysis', 'Atlanta sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportsinnovationtechsummit.com/', 'Sports Innovation & Tech Summit', 'sports_business', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports innovation conference & exhibition', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.htxsportstech.com/', 'HTX Sports Tech (Houston)', 'sports_tech', 'website', 'en', false, 'low', 'North America', 'GST', 'trend_analysis', 'Houston sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.sportsrightstech.com/', 'Sports Rights Tech', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports media rights technology — digital distribution & monetization', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.asiasportstech.com/', 'Asia Sports Tech', 'sports_tech', 'website', 'en', false, 'low', 'APAC', 'GST', 'trend_analysis', 'Asian sports technology ecosystem hub & conference', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://sportstechcanada.ca/', 'SportsTech Canada', 'sports_tech', 'website', 'en, fr', false, 'low', 'North America', 'GST', 'trend_analysis', 'Canadian sports technology network', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://theafricabusinessclub.org/', 'The Africa Business Club', 'business_consulting', 'website', 'en, fr', false, 'medium', 'Pan-Africa', 'ASE, FD', 'africa_brief, deal_tracker', 'Pan-African business networking & thought leadership community', 'ecosystem_programs, investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.sportstechie.net/', 'SportTechie', 'sports_tech', 'website', 'en', false, 'high', 'Global', 'GST', 'trend_analysis', 'Leading sports technology news & analysis publication', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sportstech.tokyo/', 'SportsTech Tokyo', 'sports_tech', 'website', 'en, ja', false, 'low', 'APAC', 'GST', 'trend_analysis', 'Tokyo/Japanese sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://sthq.org/', 'STHQ (Sports Tech HQ)', 'sports_tech', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Sports technology community hub & resource center', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.strn.co/', 'Sports Tech Research Network (STRN)', 'sports_science', 'website', 'en', false, 'medium', 'Global', 'GST', 'trend_analysis', 'Academic sports technology research network — papers, conferences, community', 'ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://levelupsportstech.com/', 'LevelUp Sports Tech', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Sports technology accelerator/incubator program', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.athlete-ventures.com/', 'Athlete Ventures', 'investment', 'website', 'en', false, 'medium', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Athlete-led venture capital — sports tech & wellness investments', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sastraining.co.za/', 'SAS Training (South Africa)', 'sports_education', 'website', 'en', false, 'medium', 'Southern Africa', 'ASE, GST', 'africa_brief', 'South African sports training & coaching education provider', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.sportechfr.com/', 'SportTech France', 'sports_tech', 'website', 'en, fr', false, 'low', 'Europe', 'GST', 'trend_analysis', 'French sports technology ecosystem hub', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://www.stws.co/', 'STWS', 'sports_tech', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'Sports technology & wellness solutions platform', 'tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://afbs.footballfoundation.africa/', 'Africa Football Business Summit (AFBS)', 'sports_business', 'website', 'en, fr', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'Football Foundation for Africa — business summit, African football development & investment', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://tripledoubleaccelerator.nba.com', 'NBA Triple Double Accelerator', 'sports_development', 'website', 'en', false, 'high', 'Pan-Africa', 'ASE, GST', 'africa_brief, trend_analysis', 'NBA Africa startup accelerator — supports African sports tech ecosystem', 'weekly_intel, ecosystem_programs')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.elsewedycapital.com/', 'El Sewedy Capital', 'investment', 'website', 'en, ar', false, 'high', 'North Africa', 'FD', 'deal_tracker, biz_intel', 'Egyptian family office — $500mn+ investments including sports tech', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://www.resilience17.com/', 'Resilience17', 'investment', 'website', 'en', false, 'high', 'West Africa', 'FD', 'deal_tracker, biz_intel', 'Nigerian investment firm — emerging sports tech and entertainment', 'investor_tracker, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://kickoff.com', 'Kickoff Africa', 'sports_news', 'website', 'en', false, 'medium', 'Southern Africa', 'ASE', 'africa_brief', 'SA soccer magazine — authority on South African football', 'weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://lp.startupnationcentral.org/global-sports-tech-startup-program', 'Global Sports Tech Startups Program', 'sports_development', 'website', 'en', false, 'medium', 'MENA', 'GST', 'trend_analysis', 'Israel-Morocco sports innovation ecosystem program', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://swingcapital.ventures', 'Swing Capital', 'investment', 'website', 'en, ar', false, 'medium', 'MENA', 'FD', 'deal_tracker', 'UAE-based sports VC — MENA/Africa deal flow potential', 'investor_tracker')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://lead.vc', 'LeAD VC', 'investment', 'website', 'en', false, 'medium', 'Global', 'FD', 'deal_tracker, trend_analysis', 'Sports-focused VC — global sports tech deals', 'investor_tracker, tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://causewaymp.com', 'Causeway Media Partners', 'investment', 'website', 'en', false, 'medium', 'Global', 'FD', 'deal_tracker, trend_analysis', 'Major sports media/tech VC — indicator of global trends', 'investor_tracker, tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://neom.com', 'NEOM Sports Innovation', 'sports_development', 'website', 'en, ar', false, 'medium', 'MENA', 'GST', 'trend_analysis', 'Saudi NEOM sports open innovation — African talent pipeline', 'ecosystem_programs, weekly_intel')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://redbull.ventures', 'Red Bull Ventures', 'investment', 'website', 'en', false, 'low', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Red Bull corporate VC — action/extreme sports tech', 'investor_tracker, tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('http://konvoy.vc', 'Konvoy Ventures', 'investment', 'website', 'en', false, 'low', 'Global', 'FD, GST', 'deal_tracker, trend_analysis', 'Gaming/esports VC — relevant for African esports growth', 'investor_tracker, tech_landscape')
ON CONFLICT (url) DO NOTHING;
INSERT INTO content_sources (url, source_name, category, source_type, languages, active, priority, region_focus, agents, outputs, notes, registries)
VALUES ('https://nbcuniversal.com', 'Comcast NBC Universal SportsTech', 'sports_development', 'website', 'en', false, 'low', 'Global', 'GST', 'trend_analysis', 'NBC major media sports tech accelerator program', 'ecosystem_programs, tech_landscape')
ON CONFLICT (url) DO NOTHING;
