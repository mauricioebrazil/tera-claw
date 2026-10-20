#!/usr/bin/env python3
"""Testes do install-ig-timers.sh: User=/HOME= vem do dono da pasta do agente, sem tocar no sistema.

Rodar:  python3 scripts/_lib/test_install_ig_timers.py

O script grava units e chama systemctl. Aqui as units vao para uma pasta tmp (TERACLAW_SYSTEMD_DIR)
e um `systemctl` falso no PATH registra as chamadas.
"""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
SCRIPT = SCRIPTS / "install-ig-timers.sh"


class InstallIgTimers(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.ws = self.tmp / "ana"
        (self.ws / ".teraclaw").mkdir(parents=True)
        self.units = self.tmp / "units"
        self.units.mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.chamadas = self.tmp / "systemctl.log"
        falso = self.bin / "systemctl"
        falso.write_text(f'#!/bin/bash\necho "$*" >> "{self.chamadas}"\n')
        falso.chmod(falso.stat().st_mode | stat.S_IEXEC)
        # catalogo minimo: o powers.py recusa poder que nao conhece
        (self.ws / ".teraclaw" / "powers.json").write_text(
            '{"schema": 1, "powers": [{"id": "instagram", "enabled": false}]}')
        self.cfg = self.ws / ".teraclaw" / "config.sh"
        self.cfg.write_text(f'TERACLAW_SLUG=ana\nTERACLAW_WORKSPACE="{self.ws}"\n')

    def rodar(self, *args, usuario=None):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", HOME="/root",
                   TERACLAW_SYSTEMD_DIR=str(self.units), TERACLAW_PLUGIN_ROOT=str(SCRIPTS.parent))
        env.pop("TERACLAW_ROTINA_USUARIO", None)
        if usuario:
            env["TERACLAW_ROTINA_USUARIO"] = usuario
        return subprocess.run(["bash", str(SCRIPT), str(self.cfg), *args],
                              capture_output=True, text=True, env=env)

    def test_units_usam_o_usuario_do_ajudante(self):
        r = self.rodar(usuario="nobody")
        self.assertEqual(r.returncode, 0, r.stderr)
        for nome in ("teraclaw-ana-post-8h.service", "teraclaw-ana-comments.service"):
            svc = (self.units / nome).read_text()
            self.assertIn("User=nobody\n", svc)
            self.assertNotIn("User=root", svc)
            self.assertNotIn("HOME=/root", svc)
        self.assertIn("enable --now teraclaw-ana-comments.timer", self.chamadas.read_text())
        self.assertIn('"enabled": true', (self.ws / ".teraclaw" / "powers.json").read_text())

    def test_sem_variavel_segue_o_dono_da_pasta(self):
        r = self.rodar()
        self.assertEqual(r.returncode, 0, r.stderr)
        import pwd
        eu = pwd.getpwuid(self.ws.stat().st_uid)
        svc = (self.units / "teraclaw-ana-comments.service").read_text()
        self.assertIn(f"User={eu.pw_name}\n", svc)
        self.assertIn(f"Environment=HOME={eu.pw_dir}\n", svc)

    def test_usuario_inexistente_para_antes_de_gravar(self):
        r = self.rodar(usuario="fantasma")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("fantasma", r.stderr)
        self.assertEqual(list(self.units.iterdir()), [])

    def test_off_remove_as_units(self):
        self.rodar(usuario="nobody")
        r = self.rodar("--off")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(list(self.units.iterdir()), [])

    def test_script_nao_tem_user_root_literal(self):
        texto = SCRIPT.read_text()
        self.assertNotIn("\nUser=root", texto)
        self.assertIn("dono_agente.py", texto)


if __name__ == "__main__":
    unittest.main()
