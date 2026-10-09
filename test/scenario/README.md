# 横断シナリオ

実SQLite（一時file/WAL・memory）で、原子性、再送、snapshot、訂正、忘却、復元、予算、性能の上限、世代をまたぐ受入を確認する。ホスト結合試験（Eumenesの単一Writer・Memory登録）はEumenes側に置くもので、ここでは未受入。
