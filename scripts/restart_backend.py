import paramiko
import sys

# Configuration
HOST = "31.97.68.170"
USERNAME = "root"
PASSWORD = "KKStechnologies2022@#"

def create_ssh_client(server, port, user, password):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(server, port, user, password)
        return client
    except Exception as e:
        print(f"[-] Error connecting to {server}: {e}")
        return None

def execute_command(client, command):
    print(f"\n[+] Executing: {command}")
    stdin, stdout, stderr = client.exec_command(command)
    
    # Wait for the command to finish and get the exit status
    exit_status = stdout.channel.recv_exit_status()
    
    output = stdout.read().decode().strip()
    error = stderr.read().decode().strip()

    if output:
        print(output)
    if error:
        print(f"[!] Stderr: {error}")
        
    return exit_status

def restart_backend():
    print("==========================================")
    print("    RESTARTING BACKEND (Pubcash)")
    print("==========================================")

    client = create_ssh_client(HOST, 22, USERNAME, PASSWORD)
    if not client:
        sys.exit(1)

    try:
        # Restart backend services
        cmd = "cd /var/www/Pubcash && pm2 restart all"
        status = execute_command(client, cmd)
        
        if status == 0:
            print("\n>>> SUCCESS: Backend restarted.")
        else:
            print("\n>>> FAILURE: Backend restart returned non-zero status.")

    except Exception as e:
        print(f"\n[-] An error occurred: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    restart_backend()
