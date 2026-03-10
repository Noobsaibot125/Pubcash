import paramiko
import time

HOST = "31.97.68.170"
USERNAME = "root"
PASSWORD = "KKStechnologies2022@#"

def debug_ssh():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {HOST}...")
        client.connect(HOST, 22, USERNAME, PASSWORD)
        print("Connected!")
        
        # Check .env existence and CinetPay vars
        cmd = "grep -E 'CINETPAY_APIKEY|CINETPAY_SECRET_KEY' /var/www/Pubcash/.env"
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode().strip()
        
        if output:
            print("\nFound CinetPay keys in .env:")
            lines = output.split('\n')
            for line in lines:
                key, val = line.split('=', 1)
                # mask value
                masked = val[:5] + "..." + val[-3:] if len(val) > 8 else "***"
                print(f"{key}={masked}")
        else:
            print("\n[-] CinetPay keys NOT found in .env via grep.")
            
        # Check connection to CinetPay from server
        print("\nChecking connectivity to CinetPay...")
        stdin, stdout, stderr = client.exec_command("curl -I https://client.cinetpay.com/v1/auth/login")
        print(stdout.read().decode().strip())
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    debug_ssh()
