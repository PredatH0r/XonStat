import os
import sys

from setuptools import setup, find_packages

here = os.path.abspath(os.path.dirname(__file__))
README = open(os.path.join(here, 'README.md')).read()
CHANGES = open(os.path.join(here, 'CHANGES.txt')).read()

requires = [
    'pyramid==1.6',
    'SQLAlchemy==1.2.7',
    'transaction==1.4.4',
    'repoze.tm2==2.0', # default_commit_veto
    'zope.sqlalchemy==0.7.6',
    'WebError==0.11',
    'sqlahelper==1.0',
    'webhelpers==1.3',
    'psycopg2==2.7.4',
    'pyramid_beaker==0.8',
    'pyramid_mako==1.0.2',
    'pyramid_persona==1.6.1',
    'waitress==1.1.0',
    
    'markupsafe==0.23',
    'repoze.lru==0.6',
    'pygments==2.1',
    'beaker==1.7.0',
    'mako==1.0.3',
    'pybrowserid==0.9.2',
    'venusian==1.0',
    'translationstring==1.3',
    'WebOb==1.5.1',
    'zope.deprecation==4.1.2',
    'zope.interface==4.1.3',
    ]

if sys.version_info[:3] < (2,5,0):
    requires.append('pysqlite')

setup(name='XonStat',
      version='0.0',
      description='XonStat',
      long_description=README + '\n\n' +  CHANGES,
      classifiers=[
        "Programming Language :: Python",
        "Framework :: Pylons",
        "Topic :: Internet :: WWW/HTTP",
        "Topic :: Internet :: WWW/HTTP :: WSGI :: Application",
        ],
      author='',
      author_email='',
      url='',
      keywords='web wsgi bfg pylons pyramid',
      packages=find_packages(),
      include_package_data=True,
      zip_safe=False,
      test_suite='xonstat',
      install_requires = requires,
      entry_points = """\
      [paste.app_factory]
      main = xonstat:main
      """,
      paster_plugins=['pyramid'],
      )

