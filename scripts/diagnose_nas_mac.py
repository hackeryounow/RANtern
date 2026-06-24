#!/usr/bin/env python3
"""
NAS MAC Diagnostic Tool
========================
Compares MAC computation between the eNB reference implementation and the
CoreSimRunner integration code for 4G LTE NAS Security Mode Complete.

Diagnoses the root cause of:
  [mme] WARNING: NAS MAC verification failed(0xXXXXXXXX != 0xYYYYYYYY)

Usage:
  python3 scripts/diagnose_nas_mac.py
  python3 scripts/diagnose_nas_mac.py --plmn 46099 --ki 12341234123412341234123412340000 ...
"""

import sys
import os
import argparse
from binascii import hexlify, unhexlify

# Add paths for imports
WORKSPACE_ROOT = '/root'
PYCRATE_PATH = os.path.join(WORKSPACE_ROOT, 'pycrate')
CRYPTOMOBILE_PATH = os.path.join(WORKSPACE_ROOT, 'CryptoMobile')
INTEGRATION_PATH = os.path.join(WORKSPACE_ROOT, '5gc', 'CoreSimRunner', 'src', 'integration')
ENB_PATH = os.path.join(WORKSPACE_ROOT, '5gc', 'CoreSimRunner', 'eNB')

for p in [PYCRATE_PATH, CRYPTOMOBILE_PATH, INTEGRATION_PATH, ENB_PATH]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from CryptoMobile.CM import EIA1, EIA2, EIA3, EEA1, EEA2, EEA3
    from CryptoMobile.Milenage import Milenage
    from Crypto.Hash import HMAC, SHA256
except ImportError as e:
    print(f"[ERROR] Missing dependencies: {e}")
    print("Please run: bash setup.sh")
    sys.exit(1)


# ============================================================================
# Default UE parameters (matching Integrated4GUE defaults)
# ============================================================================
DEFAULT_PARAMS = {
    'plmn': '46099',
    'ki': '12341234123412341234123412340000',
    'opc': '71a121bb69baf3c0cc53fb5038a0131f',
    'imsi': '460990000000001',
    'imeisv': '4370816125816151',
    # RAND and AUTN are sample values - replace with actual captured values
    'rand': '00112233445566778899aabbccddeeff',
    'autn': '00000000000000000000000000000000',  # placeholder
    'enc_alg': 0,  # 0=EEA0, 1=EEA1, 2=EEA2, 3=EEA3
    'int_alg': 2,  # 0=EIA0, 1=EIA1, 2=EIA2, 3=EIA3
    'up_count': 0,
    'direction': 0,
}


def bcd(chars):
    """BCD encode a string of hex characters."""
    bcd_string = ''
    for i in range(len(chars) // 2):
        bcd_string += chars[1 + 2 * i] + chars[2 * i]
    return bytes(bytearray.fromhex(bcd_string))


def hex_dump(data, prefix="    "):
    """Pretty hex dump of bytes."""
    return prefix + hexlify(data).decode()


# ============================================================================
# eNB Reference PLMN encoding (from eNB_LOCAL.py return_plmn)
# Used for KASME derivation in the working eNB implementation
# ============================================================================
def enb_return_plmn(plmn):
    """eNB reference PLMN encoding for KASME (CORRECT per 3GPP 24.301)."""
    plmn = str(plmn)
    if len(plmn) == 5:
        return bcd(plmn[0] + plmn[1] + plmn[2] + 'f' + plmn[3] + plmn[4])
    elif len(plmn) == 6:
        # Standard 3-digit MNC encoding: MCC2 MCC1 MNC3 MCC3 MNC1 MNC2
        return bcd(plmn[0] + plmn[1] + plmn[2] + plmn[5] + plmn[3] + plmn[4])
    return b''


# ============================================================================
# CoreSimRunner PLMN encoding (from integrated_4g_messages.py return_plmn_s1ap)
# Used for BOTH KASME derivation AND S1AP in the broken integration code
# ============================================================================
def csim_return_plmn_s1ap(plmn):
    """CoreSimRunner PLMN encoding (used for KASME - POTENTIALLY WRONG)."""
    plmn = str(plmn)
    if len(plmn) == 5:
        chars = plmn[0] + plmn[1] + plmn[2] + 'f' + plmn[3] + plmn[4]
    elif len(plmn) == 6:
        # BUG: Wrong digit order for 3-digit MNC
        chars = plmn[0] + plmn[1] + plmn[2] + plmn[3] + plmn[4] + plmn[5]
    else:
        return b''
    bcd_string = ""
    for i in range(len(chars) // 2):
        bcd_string += chars[1 + 2 * i] + chars[2 * i]
    return bytes(bytearray.fromhex(bcd_string))


# ============================================================================
# Key derivation functions (same in both implementations)
# ============================================================================
def return_kasme_with_plmn_bytes(plmn_bytes, autn_hex, ck_hex, ik_hex):
    """Derive KASME with explicit PLMN bytes (3GPP 33.401 Annex A.2)."""
    key = unhexlify(ck_hex + ik_hex)
    sqn_xor_ak = autn_hex[0:12]
    message = unhexlify('10') + plmn_bytes + unhexlify('0003') + unhexlify(sqn_xor_ak) + unhexlify('0006')
    h = HMAC.new(key, msg=message, digestmod=SHA256)
    return h.digest()[-32:]


def return_key(kasme, algo, key_type):
    """Derive NAS encryption/integrity key from KASME (3GPP 33.401 Annex A.7)."""
    if key_type == 'NAS-ENC':
        type_byte = '01'
    elif key_type == 'NAS-INT':
        type_byte = '02'
    else:
        type_byte = '01'
    algo_str = '0' + str(algo)
    message = unhexlify('15' + type_byte + '0001' + algo_str + '0001')
    h = HMAC.new(kasme, msg=message, digestmod=SHA256)
    return h.digest()[-16:]


def milenage_res_ck_ik(ki_bytes, opc_bytes, rand_hex):
    """Compute RES, CK, IK using Milenage algorithm."""
    rand_bytes = unhexlify(rand_hex)
    m = Milenage(16 * b'\x00')
    m.set_opc(opc_bytes)
    res, ck, ik, ak = m.f2345(ki_bytes, rand_bytes)
    return hexlify(res).decode(), hexlify(ck).decode(), hexlify(ik).decode()


# ============================================================================
# NAS message encoding (simplified, matching both implementations)
# ============================================================================
def nas_encode(nas_list):
    """Encode a NAS message from structured list."""
    nas = b''
    protocol_discriminator = nas_list[0][0]
    security_header = nas_list[0][1]
    nas += bytes([(security_header << 4) + protocol_discriminator])
    for i in range(1, len(nas_list)):
        iei = nas_list[i][0]
        fmt = nas_list[i][1]
        value = nas_list[i][2]
        if iei == 0:
            if fmt == 'V':
                nas += value
            elif fmt == 'LV':
                nas += bytes([len(value)]) + value
            elif fmt == 'LV-E':
                nas += bytes([len(value) // 256]) + bytes([len(value) % 256]) + value
        else:
            if fmt == 'TV':
                if iei < 16:
                    nas += bytes([(iei << 4) + value])
                else:
                    if isinstance(value, int):
                        nas += bytes([iei, value])
                    else:
                        nas += bytes([iei]) + value
            elif fmt == 'TLV':
                nas += bytes([iei]) + bytes([len(value)]) + value
            elif fmt == 'TLV-E':
                nas += bytes([iei]) + bytes([len(value) // 256]) + bytes([len(value) % 256]) + value
    return nas


def nas_security_mode_complete(imeisv=None):
    """Build plain NAS Security Mode Complete (message type 94)."""
    emm_list = []
    emm_list.append((7, 0))
    emm_list.append((0, 'V', bytes([94])))
    if imeisv is not None:
        emm_list.append((0x23, 'TLV', bcd('3' + imeisv + 'f')))
    return nas_encode(emm_list)


def nas_security_protected_nas_message(security_header, mac, sequence_number, nas_message):
    """Wrap a NAS message with security header."""
    emm_list = []
    emm_list.append((7, security_header))
    emm_list.append((0, 'V', mac))
    emm_list.append((0, 'V', sequence_number))
    emm_list.append((0, 'V', nas_message))
    return nas_encode(emm_list)


def nas_encrypt_func(nas, count, direction, key, algo):
    """Encrypt NAS message."""
    if algo == 0 or key is None:
        return nas
    elif algo == 1:
        return EEA1(key, count, 0, direction, nas)
    elif algo == 2:
        return EEA2(key, count, 0, direction, nas)
    elif algo == 3:
        return EEA3(key, count, 0, direction, nas)
    return nas


def nas_hash_func(nas, count, direction, key, algo):
    """Compute NAS integrity MAC."""
    sqn = bytes([count % 256])
    if algo == 0 or key is None:
        return b'\x00\x00\x00\x00'
    elif algo == 1:
        return EIA1(key, count, 0, direction, sqn + nas)
    elif algo == 2:
        return EIA2(key, count, 0, direction, sqn + nas)
    elif algo == 3:
        return EIA3(key, count, 0, direction, sqn + nas)
    return b'\x00\x00\x00\x00'


# ============================================================================
# Main diagnostic
# ============================================================================
def parse_security_mode_command(nas_bytes):
    """
    Parse a Security Mode Command NAS PDU (message type 93).
    Handles both plain NAS and security-protected NAS.
    Returns dict with parsed fields.
    """
    result = {}
    if len(nas_bytes) < 2:
        return result

    pd = nas_bytes[0] & 0x0F
    sh = (nas_bytes[0] >> 4) & 0x0F
    result['protocol_discriminator'] = pd
    result['security_header'] = sh

    if sh == 0:
        # Plain NAS
        msg_type = nas_bytes[1]
        ies = nas_bytes[2:]
        result['message_type'] = msg_type
    else:
        # Security-protected NAS: MAC(4) + SQN(1) + payload
        result['mac'] = nas_bytes[1:5]
        result['sqn'] = nas_bytes[5]
        ies = nas_bytes[6:]
        if len(ies) >= 2:
            result['message_type'] = ies[1] if ies[0] == 0x07 else ies[0]
            # If inner is plain EMM, skip PD byte and message type
            if ies[0] == 0x07 or (ies[0] & 0x0F) == 7:
                ies = ies[2:]  # skip PD+SH byte and msg type
            else:
                ies = ies[1:]  # skip msg type
        result['inner_nas'] = nas_bytes[6:]

    if result.get('message_type') != 93:
        return result

    # Parse SMC IEs
    pos = 0
    if len(ies) > pos:
        result['selected_algos'] = ies[pos]
        result['enc_alg'] = (ies[pos] >> 4) & 0x0F
        result['int_alg'] = ies[pos] & 0x0F
        pos += 1
    if len(ies) > pos:
        result['ksi'] = (ies[pos] >> 4) & 0x0F
        pos += 1
    if len(ies) > pos:
        cap_len = ies[pos]
        pos += 1
        result['ue_security_capabilities'] = ies[pos:pos + cap_len]
        pos += cap_len

    # Optional IEs
    result['imeisv_requested'] = False
    while pos < len(ies):
        iei = ies[pos]
        if iei == 0x55:  # Replayed nonce UE
            result['replayed_nonce_ue'] = ies[pos + 1:pos + 5]
            pos += 5
        elif iei == 0x56:  # Nonce MME
            result['nonce_mme'] = ies[pos + 1:pos + 5]
            pos += 5
        elif iei // 16 == 0xC:  # IMEISV request
            result['imeisv_requested'] = True
            result['imeisv_request_value'] = iei
            pos += 1
        elif iei == 0x4F:  # Hash MME
            hml = ies[pos + 1]
            result['hash_mme'] = ies[pos + 2:pos + 2 + hml]
            pos += 2 + hml
        elif iei == 0x6F:  # Replayed UE additional security capability
            cap_l = ies[pos + 1]
            result['ue_additional_security_cap'] = ies[pos + 2:pos + 2 + cap_l]
            pos += 2 + cap_l
        else:
            break

    return result


def run_diagnostic(params):
    """Run the full MAC diagnostic comparing eNB and CoreSimRunner approaches."""

    print("=" * 80)
    print("NAS MAC DIAGNOSTIC TOOL - Security Mode Complete")
    print("=" * 80)
    print()

    # ---- Step 0: Print parameters ----
    print("[1] INPUT PARAMETERS")
    print("-" * 60)
    print(f"  PLMN:       {params['plmn']}")
    print(f"  IMSI:       {params['imsi']}")
    print(f"  KI:         {params['ki']}")
    print(f"  OPC:        {params['opc']}")
    print(f"  RAND:       {params['rand']}")
    print(f"  AUTN:       {params['autn']}")
    print(f"  ENC_ALG:    {params['enc_alg']} ({'EEA0' if params['enc_alg']==0 else 'EEA'+str(params['enc_alg'])})")
    print(f"  INT_ALG:    {params['int_alg']} ({'EIA0' if params['int_alg']==0 else 'EIA'+str(params['int_alg'])})")
    print(f"  UP_COUNT:   {params['up_count']}")
    print(f"  DIRECTION:  {params['direction']}")
    print(f"  IMEISV:     {params.get('imeisv', 'None')}")

    # Parse SMC if provided
    smc_hex = params.get('smc_hex')
    smc_overrides = {}
    if smc_hex:
        print(f"  SMC PDU:    {smc_hex}")
        smc_bytes = bytes.fromhex(smc_hex)
        smc_parsed = parse_security_mode_command(smc_bytes)
        print()
        print("[1b] PARSED SECURITY MODE COMMAND")
        print("-" * 60)
        print(f"  Security Header: {smc_parsed.get('security_header', '?')}")
        print(f"  Message Type:    {smc_parsed.get('message_type', '?')}")
        if 'selected_algos' in smc_parsed:
            print(f"  Selected Algos:  0x{smc_parsed['selected_algos']:02x} "
                  f"(ENC={smc_parsed['enc_alg']}, INT={smc_parsed['int_alg']})")
        if 'ksi' in smc_parsed:
            print(f"  KSI:             {smc_parsed['ksi']}")
        if 'ue_security_capabilities' in smc_parsed:
            print(f"  UE Security Cap: {hexlify(smc_parsed['ue_security_capabilities']).decode()}")
        print(f"  IMEISV Requested: {smc_parsed.get('imeisv_requested', False)}")
        if 'mac' in smc_parsed:
            print(f"  SMC MAC:         {hexlify(smc_parsed['mac']).decode()}")
            print(f"  SMC SQN:         {smc_parsed.get('sqn', '?')}")

        # Override params from SMC if present (only valid algorithm values 0-3)
        if 'enc_alg' in smc_parsed and 0 <= smc_parsed['enc_alg'] <= 3:
            params['enc_alg'] = smc_parsed['enc_alg']
            smc_overrides['enc_alg'] = smc_parsed['enc_alg']
        if 'int_alg' in smc_parsed and 0 <= smc_parsed['int_alg'] <= 3:
            params['int_alg'] = smc_parsed['int_alg']
            smc_overrides['int_alg'] = smc_parsed['int_alg']
        if not smc_parsed.get('imeisv_requested'):
            params['imeisv'] = None  # clear if not requested
    print()

    ki_bytes = bytes.fromhex(params['ki'])
    opc_bytes = bytes.fromhex(params['opc'])

    # ---- Step 1: Milenage ----
    print("[2] MILENAGE COMPUTATION")
    print("-" * 60)
    res_hex, ck_hex, ik_hex = milenage_res_ck_ik(ki_bytes, opc_bytes, params['rand'])
    print(f"  RES:  {res_hex}")
    print(f"  CK:   {ck_hex}")
    print(f"  IK:   {ik_hex}")
    print()

    # ---- Step 2: PLMN encoding comparison ----
    print("[3] PLMN ENCODING COMPARISON  *** KEY DIAGNOSTIC ***")
    print("-" * 60)
    plmn_enb = enb_return_plmn(params['plmn'])
    plmn_csim = csim_return_plmn_s1ap(params['plmn'])
    print(f"  eNB reference PLMN encoding (return_plmn):     {hexlify(plmn_enb).decode()}")
    print(f"  CoreSimRunner PLMN encoding (return_plmn_s1ap): {hexlify(plmn_csim).decode()}")
    if plmn_enb == plmn_csim:
        print(f"  >> MATCH: PLMN encodings are identical")
    else:
        print(f"  >> *** MISMATCH *** PLMN encodings DIFFER!")
        print(f"  >> This causes KASME derivation to produce DIFFERENT keys!")
        print(f"  >> The eNB reference uses CORRECT 3GPP PLMN encoding for KASME.")
        print(f"  >> CoreSimRunner uses WRONG PLMN encoding (S1AP format) for KASME.")
        # Show correct encoding per 3GPP 24.301
        plmn_str = str(params['plmn'])
        if len(plmn_str) == 5:
            print(f"  >> Correct (MCC={plmn_str[:3]}, MNC={plmn_str[3:]}): "
                  f"MCC2 MCC1 'f' MCC3 MNC1 MNC2")
        elif len(plmn_str) == 6:
            print(f"  >> Correct (MCC={plmn_str[:3]}, MNC={plmn_str[3:]}): "
                  f"MCC2 MCC1 MNC3 MCC3 MNC1 MNC2")
    print()

    # ---- Step 3: KASME derivation comparison ----
    print("[4] KASME DERIVATION COMPARISON")
    print("-" * 60)
    kasme_enb = return_kasme_with_plmn_bytes(plmn_enb, params['autn'], ck_hex, ik_hex)
    kasme_csim = return_kasme_with_plmn_bytes(plmn_csim, params['autn'], ck_hex, ik_hex)
    print(f"  eNB KASME:        {hexlify(kasme_enb).decode()}")
    print(f"  CoreSimRunner KASME: {hexlify(kasme_csim).decode()}")
    if kasme_enb == kasme_csim:
        print(f"  >> MATCH: KASME values are identical")
    else:
        print(f"  >> *** MISMATCH *** KASME values DIFFER!")
        print(f"  >> Root cause: PLMN encoding difference in KASME derivation")
    print()

    # ---- Step 4: NAS key derivation ----
    print("[5] NAS KEY DERIVATION")
    print("-" * 60)
    enc_alg = params['enc_alg']
    int_alg = params['int_alg']

    # eNB keys (derive for algorithms 1-3 only)
    enb_keys = {}
    for algo in [1, 2, 3]:
        enb_keys[f'EEA{algo}'] = return_key(kasme_enb, algo, 'NAS-ENC')
        enb_keys[f'EIA{algo}'] = return_key(kasme_enb, algo, 'NAS-INT')

    # CoreSimRunner keys
    csim_keys = {}
    for algo in [1, 2, 3]:
        csim_keys[f'EEA{algo}'] = return_key(kasme_csim, algo, 'NAS-ENC')
        csim_keys[f'EIA{algo}'] = return_key(kasme_csim, algo, 'NAS-INT')

    if int_alg > 0:
        print(f"  eNB NAS-KEY-EIA{int_alg}:  {hexlify(enb_keys[f'EIA{int_alg}']).decode()}")
        print(f"  CSim NAS-KEY-EIA{int_alg}: {hexlify(csim_keys[f'EIA{int_alg}']).decode()}")
    else:
        print(f"  INT_ALG=0 (EIA0/null integrity) - no integrity key needed")
    if enc_alg > 0:
        print(f"  eNB NAS-KEY-EEA{enc_alg}:  {hexlify(enb_keys[f'EEA{enc_alg}']).decode()}")
        print(f"  CSim NAS-KEY-EEA{enc_alg}: {hexlify(csim_keys[f'EEA{enc_alg}']).decode()}")
    else:
        print(f"  ENC_ALG=0 (EEA0/null cipher) - no encryption key needed")
    if int_alg > 0 and enb_keys.get(f'EIA{int_alg}') == csim_keys.get(f'EIA{int_alg}'):
        print(f"  >> MATCH: Integrity keys are identical")
    elif int_alg > 0:
        print(f"  >> *** MISMATCH *** Integrity keys DIFFER!")
    print()

    # ---- Step 5: Build Security Mode Complete NAS ----
    print("[6] SECURITY MODE COMPLETE NAS MESSAGE")
    print("-" * 60)
    imeisv = params.get('imeisv')
    smc_plain = nas_security_mode_complete(imeisv=imeisv)
    print(f"  Plain NAS bytes: {hexlify(smc_plain).decode()}")
    print(f"  Plain NAS length: {len(smc_plain)} bytes")
    print(f"  Breakdown:")
    print(f"    Byte 0 (PD+SH):  0x{smc_plain[0]:02x} (PD=7/EMM, SH=0/plain)")
    print(f"    Byte 1 (MsgType): 0x{smc_plain[1]:02x} (94=Security Mode Complete)")
    if imeisv:
        print(f"    IE 0x23 (IMEISV): {hexlify(smc_plain[2:]).decode()}")
    print()

    # ---- Step 6: Encryption ----
    print("[7] NAS ENCRYPTION")
    print("-" * 60)
    up_count = params['up_count']
    direction = params['direction']

    enc_key_enb = enb_keys.get(f'EEA{enc_alg}') if enc_alg > 0 else None
    enc_key_csim = csim_keys.get(f'EEA{enc_alg}') if enc_alg > 0 else None

    encrypted_enb = nas_encrypt_func(smc_plain, up_count, direction, enc_key_enb, enc_alg)
    encrypted_csim = nas_encrypt_func(smc_plain, up_count, direction, enc_key_csim, enc_alg)

    print(f"  eNB encrypted NAS:  {hexlify(encrypted_enb).decode()}")
    print(f"  CSim encrypted NAS: {hexlify(encrypted_csim).decode()}")
    if encrypted_enb == encrypted_csim:
        print(f"  >> MATCH: Encrypted NAS identical")
    else:
        print(f"  >> *** MISMATCH *** Encrypted NAS DIFFER!")
    print()

    # ---- Step 7: MAC computation ----
    print("[8] NAS MAC COMPUTATION  *** THE KEY COMPARISON ***")
    print("-" * 60)
    int_key_enb = enb_keys.get(f'EIA{int_alg}') if int_alg > 0 else None
    int_key_csim = csim_keys.get(f'EIA{int_alg}') if int_alg > 0 else None

    print(f"  Inputs to EIA function:")
    print(f"    COUNT:     {up_count}")
    print(f"    BEARER:    0")
    print(f"    DIRECTION: {direction}")
    print(f"    SQN byte:  0x{up_count % 256:02x}")

    # Show the data fed to EIA: sqn + encrypted_nas
    sqn = bytes([up_count % 256])
    eia_input_enb = sqn + encrypted_enb
    eia_input_csim = sqn + encrypted_csim
    print(f"    eNB EIA input (sqn+nas):  {hexlify(eia_input_enb).decode()}")
    print(f"    CSim EIA input (sqn+nas): {hexlify(eia_input_csim).decode()}")

    mac_enb = nas_hash_func(encrypted_enb, up_count, direction, int_key_enb, int_alg)
    mac_csim = nas_hash_func(encrypted_csim, up_count, direction, int_key_csim, int_alg)

    print()
    print(f"  eNB MAC:  0x{hexlify(mac_enb).decode()}")
    print(f"  CSim MAC: 0x{hexlify(mac_csim).decode()}")
    if mac_enb == mac_csim:
        print(f"  >> MATCH: MACs are identical")
    else:
        print(f"  >> *** MISMATCH *** MACs DIFFER!")
        print(f"  >> This is what causes the MME MAC verification failure!")
    print()

    # ---- Step 8: Full security-protected NAS ----
    print("[9] FULL SECURITY-PROTECTED NAS MESSAGE")
    print("-" * 60)
    sqn_byte = bytes([up_count % 256])
    # Security header 4 = integrity + ciphered + new EPS security context
    protected_enb = nas_security_protected_nas_message(4, mac_enb, sqn_byte, encrypted_enb)
    protected_csim = nas_security_protected_nas_message(4, mac_csim, sqn_byte, encrypted_csim)
    print(f"  eNB protected NAS:  {hexlify(protected_enb).decode()}")
    print(f"  CSim protected NAS: {hexlify(protected_csim).decode()}")
    if protected_enb == protected_csim:
        print(f"  >> MATCH: Full messages are identical")
    else:
        print(f"  >> *** MISMATCH *** Full messages DIFFER!")
    print()

    # ---- Step 9: Compare with actual captured SMC Complete if provided ----
    smc_complete_hex = params.get('smc_complete_hex')
    if smc_complete_hex:
        print()
        print("[10] COMPARISON WITH CAPTURED SECURITY MODE COMPLETE")
        print("-" * 60)
        captured = bytes.fromhex(smc_complete_hex)
        print(f"  Captured:  {hexlify(captured).decode()}")
        print(f"  eNB built: {hexlify(protected_enb).decode()}")
        print(f"  CSim built:{hexlify(protected_csim).decode()}")
        if captured == protected_enb:
            print(f"  >> Captured matches eNB output")
        elif captured == protected_csim:
            print(f"  >> Captured matches CoreSimRunner output")
        else:
            print(f"  >> Captured does NOT match either output")
            # Extract MAC from captured
            if len(captured) >= 6:
                cap_mac = captured[1:5]
                cap_sqn = captured[5]
                cap_payload = captured[6:]
                print(f"  Captured MAC:  0x{hexlify(cap_mac).decode()}")
                print(f"  Captured SQN:  {cap_sqn}")
                print(f"  Captured payload: {hexlify(cap_payload).decode()}")
                # Try to recompute MAC with captured payload
                print()
                print("  Recomputing MAC with captured payload:")
                for label, int_key in [("eNB KASME", int_key_enb), ("CSim KASME", int_key_csim)]:
                    for cnt in range(0, 5):
                        recomputed = nas_hash_func(cap_payload, cnt, 0, int_key, int_alg)
                        match = " *** MATCH ***" if recomputed == cap_mac else ""
                        print(f"    {label} count={cnt}: MAC=0x{hexlify(recomputed).decode()}{match}")
        print()

    # ---- Summary ----
    print("=" * 80)
    print("DIAGNOSIS SUMMARY")
    print("=" * 80)
    if plmn_enb != plmn_csim:
        print()
        print("*** ROOT CAUSE FOUND: PLMN encoding mismatch in KASME derivation ***")
        print()
        print("The CoreSimRunner uses return_plmn_s1ap() for KASME derivation,")
        print("which produces INCORRECT PLMN encoding per 3GPP 24.301.")
        print()
        print("The eNB reference uses return_plmn() which produces CORRECT encoding:")
        print(f"  Correct PLMN bytes:  {hexlify(plmn_enb).decode()}")
        print(f"  Wrong PLMN bytes:    {hexlify(plmn_csim).decode()}")
        print()
        print("FIX: In integrated_4g_messages.py return_kasme(), replace:")
        print("  plmn_bytes = return_plmn_s1ap(plmn)")
        print("with a correct PLMN encoding function:")
        plmn_str = str(params['plmn'])
        if len(plmn_str) == 5:
            print(f"  For PLMN '{plmn_str}': bcd('{plmn_str[0]}{plmn_str[1]}{plmn_str[2]}f{plmn_str[3]}{plmn_str[4]}')")
        elif len(plmn_str) == 6:
            print(f"  For PLMN '{plmn_str}': bcd('{plmn_str[0]}{plmn_str[1]}{plmn_str[2]}{plmn_str[5]}{plmn_str[3]}{plmn_str[4]}')")
        print()
        print("The return_plmn_s1ap() function should ONLY be used for S1AP messages,")
        print("NOT for KASME derivation. KASME requires standard 3GPP PLMN encoding.")
    elif kasme_enb != kasme_csim:
        print("*** KASME mismatch despite matching PLMN - check AUTN/CK/IK handling ***")
    elif mac_enb != mac_csim:
        print("*** MAC mismatch despite matching keys - check NAS message/count/direction ***")
    else:
        print("All values match between eNB and CoreSimRunner approaches.")
        print("The issue may be elsewhere (e.g., wrong algorithm selection, counter value, etc.)")
    print()


def main():
    parser = argparse.ArgumentParser(description='NAS MAC Diagnostic Tool')
    parser.add_argument('--plmn', default=DEFAULT_PARAMS['plmn'], help='PLMN (5 or 6 digits)')
    parser.add_argument('--ki', default=DEFAULT_PARAMS['ki'], help='Subscriber key (hex)')
    parser.add_argument('--opc', default=DEFAULT_PARAMS['opc'], help='OPc value (hex)')
    parser.add_argument('--imsi', default=DEFAULT_PARAMS['imsi'], help='IMSI')
    parser.add_argument('--rand', default=DEFAULT_PARAMS['rand'], help='RAND value (hex)')
    parser.add_argument('--autn', default=DEFAULT_PARAMS['autn'], help='AUTN value (hex)')
    parser.add_argument('--enc-alg', type=int, default=DEFAULT_PARAMS['enc_alg'],
                        help='Encryption algorithm (0-3)')
    parser.add_argument('--int-alg', type=int, default=DEFAULT_PARAMS['int_alg'],
                        help='Integrity algorithm (0-3)')
    parser.add_argument('--up-count', type=int, default=DEFAULT_PARAMS['up_count'],
                        help='Uplink NAS COUNT')
    parser.add_argument('--direction', type=int, default=DEFAULT_PARAMS['direction'],
                        help='Direction (0=uplink, 1=downlink)')
    parser.add_argument('--imeisv', default=DEFAULT_PARAMS.get('imeisv'),
                        help='IMEISV string (or "none")')
    parser.add_argument('--smc-hex', default=None,
                        help='Security Mode Command NAS PDU as hex string')
    parser.add_argument('--smc-complete-hex', default=None,
                        help='Actual Security Mode Complete NAS PDU as hex (for comparison)')

    args = parser.parse_args()

    params = {
        'plmn': args.plmn,
        'ki': args.ki,
        'opc': args.opc,
        'imsi': args.imsi,
        'imeisv': args.imeisv if args.imeisv and args.imeisv.lower() != 'none' else None,
        'rand': args.rand,
        'autn': args.autn,
        'enc_alg': args.enc_alg,
        'int_alg': args.int_alg,
        'up_count': args.up_count,
        'direction': args.direction,
        'smc_hex': args.smc_hex,
        'smc_complete_hex': args.smc_complete_hex,
    }

    run_diagnostic(params)


if __name__ == '__main__':
    main()
